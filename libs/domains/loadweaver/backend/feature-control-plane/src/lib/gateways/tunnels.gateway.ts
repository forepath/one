import { buildRequestFromSocketUser, SocketAuthService, type SocketUserInfo } from '@forepath/identity/backend';
import { LIVE_CHUNK_BYTES } from '@forepath/loadweaver/shared/util-agent-protocol';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectDataSource } from '@nestjs/typeorm';
import { Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import { z } from 'zod';

import { LiveAccessService, type LiveTarget } from '../live/live-access.service';
import { LiveBroker } from '../live/live-broker';
import { clientBacklog, MAX_CLIENT_BUFFERED_PACKETS, TokenBucket } from '../live/rate.utils';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';

const MAX_TTL_SECONDS = 8 * 3600;
const MAX_TUNNELS_PER_SOCKET = 16;
/** Client → replica: 8 MiB/s per tunnel, bursts of 16 MiB (base64 characters). */
const DATA_RATE = 8 * 1024 * 1024;
const DATA_BURST = 16 * 1024 * 1024;
/** Open tunnels are re-checked (access, heartbeat for crash cleanup) this often. */
const CHECK_MS = 60_000;
const TUNNEL_ID = /^[A-Za-z0-9_-]{1,64}$/;

const openSchema = z
  .object({
    tunnelId: z.string().regex(TUNNEL_ID),
    replica: z.string().regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}\/\d{1,4}$/),
    port: z.number().int().min(1).max(65535),
    ttlSeconds: z.number().int().min(60).max(MAX_TTL_SECONDS).default(3600),
  })
  .strict();
/** At most one protocol chunk (256 KiB → 349,528 base64 characters), base64 only. */
const dataSchema = z
  .object({
    tunnelId: z.string().regex(TUNNEL_ID),
    data: z
      .string()
      .max(Math.ceil(LIVE_CHUNK_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();
const closeSchema = z.object({ tunnelId: z.string().regex(TUNNEL_ID) }).strict();

interface Tunnel {
  id: string;
  dbId: string;
  socket: Socket;
  channel: string;
  target: LiveTarget;
  recheck: () => Promise<LiveTarget>;
  data: TokenBucket;
  expiry: NodeJS.Timeout;
  closed: boolean;
}

type TunnelSocket = Socket & { data: { userInfo?: SocketUserInfo } };

/**
 * Debug tunnels (3.19): `loadweaver port-forward` opens one per local connection; bytes travel as base64 through the
 * control plane and the node's stream to a replica's port. Operators and admins only, time-limited, audited and
 * listed (the map shows them as temporary operator edges). No policy change: it ends with the session.
 */
@WebSocketGateway({
  namespace: process.env.LOADWEAVER_TUNNELS_WEBSOCKET_NAMESPACE || 'socket/tunnels',
  cors: { origin: resolveWebsocketCorsOrigin() },
})
export class TunnelsGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TunnelsGateway.name);
  private readonly tunnels = new Map<string, Tunnel>();
  private checks: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly socketAuth: SocketAuthService,
    private readonly live: LiveBroker,
    private readonly liveAccess: LiveAccessService,
    private readonly audit: AuditLogService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const header = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
      const userInfo = await this.socketAuth.validateAndGetUser(typeof header === 'string' ? header : undefined);

      if (!userInfo) {
        next(new Error('Unauthorized'));

        return;
      }

      (socket as TunnelSocket).data = { userInfo };
      next();
    });
    this.checks = setInterval(() => void this.check(), CHECK_MS);
  }

  onModuleDestroy(): void {
    if (this.checks) clearInterval(this.checks);
  }

  /** Heartbeat for the open tunnels (a crashed replica's are closed by the sweep), access re-checked. */
  private async check(): Promise<void> {
    const tunnels = [...this.tunnels.values()];

    if (tunnels.length === 0) return;

    await this.dataSource
      .query(`UPDATE lw_tunnels SET seen_at = now() WHERE id = ANY($1::uuid[])`, [tunnels.map((t) => t.dbId)])
      .catch((e: unknown) => this.logger.warn(`Tunnel heartbeat: ${String(e)}`));

    for (const tunnel of tunnels) await tunnel.recheck().catch(() => this.close(tunnel, 'access revoked'));
  }

  private key(socket: Socket, id: string): string {
    return `${socket.id}:${id}`;
  }

  @SubscribeMessage('openTunnel')
  async open(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = openSchema.safeParse(body ?? {});

    if (!parsed.success) return void socket.emit('tunnelError', { message: 'invalid payload' });

    const dto = parsed.data;

    if (
      this.tunnels.has(this.key(socket, dto.tunnelId)) ||
      [...this.tunnels.values()].filter((t) => t.socket === socket).length >= MAX_TUNNELS_PER_SOCKET
    )
      return void socket.emit('tunnelError', { tunnelId: dto.tunnelId, message: 'too many tunnels or duplicate id' });

    const req = buildRequestFromSocketUser((socket as TunnelSocket).data.userInfo as SocketUserInfo);
    const recheck = () => this.liveAccess.replica(req, dto.replica, 'tunnel');
    let target: LiveTarget;

    try {
      target = await recheck();
    } catch (error) {
      return void socket.emit('tunnelError', {
        tunnelId: dto.tunnelId,
        message: error instanceof Error ? error.message : 'not allowed',
      });
    }

    const actor = actorFromRequest(req);
    const expiresAt = new Date(Date.now() + dto.ttlSeconds * 1000);
    const [row]: { id: string }[] = await this.dataSource.transaction(async (manager) => {
      const inserted = await manager.query(
        `INSERT INTO lw_tunnels (user_id, project, replica, node, port, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [actor.id ?? actor.type, target.project, dto.replica, target.node, dto.port, expiresAt],
      );

      await this.audit.record(manager, {
        actor,
        action: 'tunnel.open',
        target: target.target,
        project: target.project,
        details: { port: dto.port, until: expiresAt.toISOString(), tunnel: inserted[0].id },
      });

      return inserted;
    });
    const tunnel: Tunnel = {
      id: dto.tunnelId,
      dbId: row.id,
      socket,
      channel: '',
      target,
      recheck,
      data: new TokenBucket(DATA_RATE, DATA_BURST),
      expiry: setTimeout(() => void this.close(tunnel, 'expired'), dto.ttlSeconds * 1000),
      closed: false,
    };

    tunnel.channel = this.live.openChannel((type, payload) => {
      if (type === 'tunnelData') {
        // socket.io has no backpressure: a client that doesn't read loses its tunnel instead of filling memory.
        if (clientBacklog(socket) > MAX_CLIENT_BUFFERED_PACKETS) return void this.close(tunnel, 'client too slow');

        socket.emit('tunnelData', { tunnelId: dto.tunnelId, data: payload['data'] });
      } else if (type === 'tunnelClose')
        void this.finish(tunnel, (payload['reason'] as string | undefined) ?? 'closed by the node');
    });
    this.tunnels.set(this.key(socket, dto.tunnelId), tunnel);

    try {
      await this.live.send(target.node, tunnel.channel, 'tunnelOpen', { replica: dto.replica, port: dto.port });
      socket.emit('tunnelOpened', { tunnelId: dto.tunnelId, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      await this.finish(tunnel, error instanceof Error ? error.message : 'node not reachable');
    }
  }

  @SubscribeMessage('tunnelData')
  async data(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = dataSchema.safeParse(body);
    const tunnel = parsed.success ? this.tunnels.get(this.key(socket, parsed.data.tunnelId)) : undefined;

    if (!parsed.success || !tunnel) return;

    // Dropping bytes would corrupt the stream: over the limit, the tunnel ends.
    if (!tunnel.data.take(parsed.data.data.length)) return void (await this.close(tunnel, 'rate limit exceeded'));

    await this.live
      .send(tunnel.target.node, tunnel.channel, 'tunnelData', { data: parsed.data.data })
      .catch(() => undefined);
  }

  @SubscribeMessage('closeTunnel')
  async closeTunnel(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = closeSchema.safeParse(body);
    const tunnel = parsed.success ? this.tunnels.get(this.key(socket, parsed.data.tunnelId)) : undefined;

    if (tunnel) await this.close(tunnel, 'closed');
  }

  handleDisconnect(socket: Socket): void {
    for (const tunnel of [...this.tunnels.values()].filter((t) => t.socket === socket))
      void this.close(tunnel, 'disconnected');
  }

  private async close(tunnel: Tunnel, reason: string): Promise<void> {
    await this.live.send(tunnel.target.node, tunnel.channel, 'tunnelClose', { reason }).catch(() => undefined);
    await this.finish(tunnel, reason);
  }

  private async finish(tunnel: Tunnel, reason: string): Promise<void> {
    if (tunnel.closed) return;

    tunnel.closed = true;
    clearTimeout(tunnel.expiry);
    this.tunnels.delete(this.key(tunnel.socket, tunnel.id));
    this.live.closeChannel(tunnel.channel);
    await this.dataSource
      .transaction(async (manager) => {
        await manager.query(`UPDATE lw_tunnels SET closed_at = now() WHERE id = $1`, [tunnel.dbId]);
        await this.audit.record(manager, {
          actor: actorFromRequest(
            buildRequestFromSocketUser((tunnel.socket as TunnelSocket).data.userInfo as SocketUserInfo),
          ),
          action: 'tunnel.close',
          target: tunnel.target.target,
          project: tunnel.target.project,
          details: { tunnel: tunnel.dbId, reason: reason.slice(0, 200) },
        });
      })
      .catch((error: unknown) => this.logger.warn(`Tunnel ${tunnel.dbId} not recorded: ${String(error)}`));
    // Recorded first, so a client that reacts to the event sees the tunnel gone everywhere.
    tunnel.socket.emit('tunnelClosed', { tunnelId: tunnel.id, reason });
  }
}
