import { SocketAuthService, UserRole, type SocketUserInfo } from '@forepath/identity/backend';
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { MarkEnvironmentReadPayload, SetActiveEnvironmentPayload } from '../dto/agent-console-status.dto';
import { AgentConsoleStatusRealtimeService } from '../services/agent-console-status-realtime.service';
import { AgentConsoleStatusService } from '../services/agent-console-status.service';

const MIN_POLL_MS = 10_000;
const MAX_POLL_MS = 120_000;

function defaultPollIntervalMs(): number {
  const raw = parseInt(process.env.STATUS_POLL_INTERVAL_MS || '30000', 10);

  if (Number.isNaN(raw)) {
    return 30_000;
  }

  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, raw));
}

type StatusSocket = Socket & { data: { userInfo?: SocketUserInfo } };

@WebSocketGateway(parseInt(process.env.WEBSOCKET_PORT || '8081', 10), {
  namespace: process.env.STATUS_WEBSOCKET_NAMESPACE || 'status',
  cors: {
    origin: process.env.WEBSOCKET_CORS_ORIGIN || '*',
  },
})
export class StatusGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(StatusGateway.name);
  private readonly pollTimerBySocketId = new Map<string, ReturnType<typeof setInterval>>();
  private readonly tickInFlight = new Set<string>();

  constructor(
    private readonly socketAuthService: SocketAuthService,
    private readonly statusService: AgentConsoleStatusService,
    private readonly statusRealtime: AgentConsoleStatusRealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.statusRealtime.attachServer(server);
    server.use(async (socket, next) => {
      const authHeader = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.Authorization;
      const userInfo = await this.socketAuthService.validateAndGetUser(
        typeof authHeader === 'string' ? authHeader : undefined,
      );

      if (!userInfo) {
        this.logger.warn(`Status WS rejected: invalid authorization for socket ${socket.id}`);
        next(new Error('Unauthorized'));

        return;
      }

      (socket as StatusSocket).data = { userInfo };
      next();
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const userInfo = (socket as StatusSocket).data?.userInfo;
    const userId = userInfo?.user?.id ?? userInfo?.userId;

    if (!userId) {
      socket.emit('error', { message: 'User not authenticated' });
      socket.disconnect();

      return;
    }

    this.statusRealtime.registerSocket(userId, socket.id, userInfo.userRole ?? UserRole.USER);
    this.logger.debug(`Status client connected: ${socket.id} (user ${userId})`);

    await this.statusService.emitSnapshotToSocket(socket.id, userInfo);
    this.startPoll(socket as StatusSocket);
  }

  handleDisconnect(socket: Socket): void {
    this.clearPollTimer(socket.id);
    this.tickInFlight.delete(socket.id);
    this.statusService.clearSocket(socket.id);
    this.statusRealtime.unregisterSocket(socket.id);
    this.logger.debug(`Status client disconnected: ${socket.id}`);
  }

  @SubscribeMessage('markEnvironmentRead')
  async handleMarkEnvironmentRead(
    @MessageBody() body: MarkEnvironmentReadPayload,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const userInfo = (socket as StatusSocket).data?.userInfo;

    if (!userInfo) {
      socket.emit('error', { message: 'Unauthorized' });

      return;
    }

    const clientId = body?.clientId;
    const agentId = body?.agentId;

    if (!clientId || !agentId) {
      socket.emit('error', { message: 'clientId and agentId are required' });

      return;
    }

    try {
      await this.statusService.markEnvironmentRead(userInfo, clientId, agentId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to mark environment read';

      socket.emit('error', { message });
    }
  }

  @SubscribeMessage('setActiveEnvironment')
  handleSetActiveEnvironment(
    @MessageBody() body: SetActiveEnvironmentPayload,
    @ConnectedSocket() socket: Socket,
  ): void {
    const userInfo = (socket as StatusSocket).data?.userInfo;

    if (!userInfo) {
      socket.emit('error', { message: 'Unauthorized' });

      return;
    }

    this.statusService.setActiveEnvironment(socket.id, body?.clientId ?? null, body?.agentId ?? null);
  }

  private startPoll(socket: StatusSocket): void {
    this.clearPollTimer(socket.id);
    const intervalMs = defaultPollIntervalMs();
    const timer = setInterval(() => {
      void this.runPollTick(socket);
    }, intervalMs);

    this.pollTimerBySocketId.set(socket.id, timer);
  }

  private clearPollTimer(socketId: string): void {
    const existing = this.pollTimerBySocketId.get(socketId);

    if (existing) {
      clearInterval(existing);
      this.pollTimerBySocketId.delete(socketId);
    }
  }

  private async runPollTick(socket: StatusSocket): Promise<void> {
    if (this.tickInFlight.has(socket.id)) {
      return;
    }

    this.tickInFlight.add(socket.id);
    const userInfo = socket.data?.userInfo;

    if (!userInfo) {
      this.tickInFlight.delete(socket.id);

      return;
    }

    try {
      await this.statusService.runPollForSocket(socket.id, userInfo);
    } catch (error: unknown) {
      this.logger.warn(`Status poll failed for socket ${socket.id}: ${(error as Error).message}`);
    } finally {
      this.tickInFlight.delete(socket.id);
    }
  }
}
