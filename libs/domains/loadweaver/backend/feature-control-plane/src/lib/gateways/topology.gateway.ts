import {
  buildRequestFromSocketUser,
  SocketAuthService,
  type RequestWithUser,
  type SocketUserInfo,
} from '@forepath/identity/backend';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { ProjectAccessService } from '../access/project-access.service';
import { TopologyService } from '../topology/topology.service';

const TICK_MS = 10_000;
const MAX_SUBSCRIBERS = 2_000;
const MAX_SUBSCRIPTIONS_PER_USER = 5;
/** Subscribers' access is re-checked every this many ticks (a removed cluster role stops the stream). */
const RECHECK_TICKS = 6;

type TopologySocket = Socket & { data: { userInfo?: SocketUserInfo } };

/**
 * Live traffic on the map (3.9) for cluster roles: after `subscribe`, every 10 s the flows of the last minute
 * (`flows`). One computation per tick for all subscribers (flows aren't attributed to projects, so project members
 * get the map without traffic).
 */
@WebSocketGateway({
  namespace: process.env.LOADWEAVER_TOPOLOGY_WEBSOCKET_NAMESPACE || 'socket/topology',
  cors: { origin: resolveWebsocketCorsOrigin() },
})
export class TopologyGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TopologyGateway.name);
  private readonly subscribers = new Map<string, { socket: Socket; req: RequestWithUser; user: string }>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticks = 0;

  constructor(
    private readonly socketAuth: SocketAuthService,
    private readonly access: ProjectAccessService,
    private readonly topology: TopologyService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const header = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
      const userInfo = await this.socketAuth.validateAndGetUser(typeof header === 'string' ? header : undefined);

      if (!userInfo) {
        next(new Error('Unauthorized'));

        return;
      }

      (socket as TopologySocket).data = { userInfo };
      next();
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() socket: Socket): Promise<void> {
    if (this.subscribers.has(socket.id)) return;

    const req = buildRequestFromSocketUser((socket as TopologySocket).data.userInfo as SocketUserInfo);
    const caller = await this.access.caller(req);
    const user = caller.userId ?? (caller.isApiKey ? 'api-key' : socket.id);

    if (!socket.connected || this.subscribers.has(socket.id)) return;

    if (!caller.clusterRole) return void socket.emit('error', { message: 'live traffic needs a cluster role' });

    if (
      this.subscribers.size >= MAX_SUBSCRIBERS ||
      [...this.subscribers.values()].filter((s) => s.user === user).length >= MAX_SUBSCRIPTIONS_PER_USER
    )
      return void socket.emit('error', { message: 'too many subscribers' });

    this.subscribers.set(socket.id, { socket, req, user });

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
    }
  }

  private async tick(): Promise<void> {
    if (this.running || this.subscribers.size === 0) return;

    this.running = true;

    try {
      if (++this.ticks % RECHECK_TICKS === 0)
        for (const [id, s] of this.subscribers)
          if (!(await this.access.caller(s.req)).clusterRole) {
            this.subscribers.delete(id);
            s.socket.emit('error', { message: 'live traffic needs a cluster role' });
          }

      const edges = await this.topology.liveFlows();
      const at = new Date().toISOString();

      for (const { socket } of this.subscribers.values()) socket.emit('flows', { at, edges });
    } catch (error) {
      this.logger.warn(`Live flows: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
