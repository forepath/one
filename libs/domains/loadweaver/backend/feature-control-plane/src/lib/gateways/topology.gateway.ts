import {
  buildRequestFromSocketUser,
  SocketAuthService,
  type RequestWithUser,
  type SocketUserInfo,
} from '@forepath/identity/backend';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { ProjectAccessService } from '../access/project-access.service';
import type { FleetIdentityRequest, VerifiedFleetIdentity } from '../fleet-identity/fleet-identity.utils';
import { TrustedFleetsService } from '../fleet-identity/trusted-fleets.service';
import { TopologyService } from '../topology/topology.service';

const TICK_MS = 10_000;
const MAX_SUBSCRIBERS = 2_000;
const MAX_SUBSCRIPTIONS_PER_USER = 5;
/** Subscribers' access is re-checked every this many ticks (a removed cluster role stops the stream). */
const RECHECK_TICKS = 6;

type TopologySocket = Socket & { data: { userInfo?: SocketUserInfo; fleetIdentity?: VerifiedFleetIdentity } };

/**
 * Live traffic on the map (3.9) for cluster roles: after `subscribe`, every 10 s the flows of the last minute
 * (`flows`). One computation per tick for all subscribers (flows aren't attributed to projects, so project members
 * get the map without traffic). With `subscribe { structure: true }` (3.36 B3) every subscriber — project members
 * too — also gets `structureChanged { version }` when the map's structure changes (compiled revision, placements),
 * so the console reloads `GET /topology` instead of polling.
 */
@WebSocketGateway({
  namespace: process.env.LOADWEAVER_TOPOLOGY_WEBSOCKET_NAMESPACE || 'socket/topology',
  cors: { origin: resolveWebsocketCorsOrigin() },
})
export class TopologyGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TopologyGateway.name);
  private readonly subscribers = new Map<
    string,
    { socket: Socket; req: RequestWithUser; user: string; flows: boolean; structure: boolean }
  >();
  private version: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticks = 0;

  constructor(
    private readonly socketAuth: SocketAuthService,
    private readonly access: ProjectAccessService,
    private readonly topology: TopologyService,
    /** Person-scoped streams through a fleet (2026-10-27): verifies the handshake's signed claim. */
    @Optional() private readonly fleets?: TrustedFleetsService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const header = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
      const userInfo = await this.socketAuth.validateAndGetUser(typeof header === 'string' ? header : undefined);

      if (!userInfo) {
        next(new Error('Unauthorized'));

        return;
      }

      // A fleet's subscription for a person with project grants carries their signed claim (2026-10-27): the stream
      // then acts as that person (capped by the connecting user's roles) and carries only their projects' events.
      const evaluation = this.fleets
        ? await this.fleets.evaluateSocket(socket.handshake?.auth?.['fleetIdentity'], 'topology').catch(() => null)
        : null;

      if (evaluation?.result === 'refused') {
        next(new Error(`fleet identity claim refused: ${evaluation.reason}`));

        return;
      }

      (socket as TopologySocket).data = {
        userInfo,
        ...(evaluation?.result === 'verified' ? { fleetIdentity: evaluation.identity } : {}),
      };
      next();
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body?: { structure?: boolean } | null,
  ): Promise<void> {
    if (this.subscribers.has(socket.id)) return;

    const structure = body?.structure === true;

    const data = (socket as TopologySocket).data;
    const req: FleetIdentityRequest = Object.assign(buildRequestFromSocketUser(data.userInfo as SocketUserInfo), {
      fleetIdentity: data.fleetIdentity,
    });
    const caller = await this.access.caller(req);
    const user = caller.userId ?? (caller.isApiKey ? 'api-key' : socket.id);

    if (!socket.connected || this.subscribers.has(socket.id)) return;

    // Project members: structure changes only (flows aren't attributed to projects).
    if (!caller.clusterRole && !structure)
      return void socket.emit('error', { message: 'live traffic needs a cluster role' });

    if (
      this.subscribers.size >= MAX_SUBSCRIBERS ||
      [...this.subscribers.values()].filter((s) => s.user === user).length >= MAX_SUBSCRIPTIONS_PER_USER
    )
      return void socket.emit('error', { message: 'too many subscribers' });

    this.subscribers.set(socket.id, { socket, req, user, flows: !!caller.clusterRole, structure });

    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), TICK_MS);
      void this.tick();
    }
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(@ConnectedSocket() socket: Socket): void {
    this.handleDisconnect(socket);
  }

  handleDisconnect(socket: Socket): void {
    this.subscribers.delete(socket.id);

    if (this.subscribers.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.version = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running || this.subscribers.size === 0) return;

    this.running = true;

    try {
      if (++this.ticks % RECHECK_TICKS === 0)
        for (const [id, s] of this.subscribers)
          if (s.flows && !(await this.access.caller(s.req)).clusterRole) {
            s.socket.emit('error', { message: 'live traffic needs a cluster role' });

            if (s.structure) s.flows = false;
            else this.subscribers.delete(id);
          }

      const subscribers = [...this.subscribers.values()];

      if (subscribers.some((s) => s.structure)) {
        const version = await this.topology.structureVersion();

        if (this.version !== null && version !== this.version)
          for (const s of subscribers) if (s.structure) s.socket.emit('structureChanged', { version });

        this.version = version;
      }

      if (subscribers.some((s) => s.flows)) {
        const edges = await this.topology.liveFlows();
        const at = new Date().toISOString();

        for (const s of subscribers) if (s.flows) s.socket.emit('flows', { at, edges });
      }
    } catch (error) {
      this.logger.warn(`Live flows: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
