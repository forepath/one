import { SocketAuthService, type SocketUserInfo } from '@forepath/identity/backend';
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

import { SubscriptionStatus } from '../entities/subscription.entity';
import { SubscriptionItemServerService } from '../services/subscription-item-server.service';
import { SubscriptionService } from '../services/subscription.service';
import { getBillingUserIdFromSocketUser } from '../utils/billing-socket-user.utils';

const MIN_POLL_MS = 10_000;
const MAX_POLL_MS = 120_000;

function defaultPollIntervalMs(): number {
  const raw = parseInt(process.env.STATUS_POLL_INTERVAL || '15000', 10);

  if (Number.isNaN(raw)) {
    return 15_000;
  }

  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, raw));
}

function clampPollIntervalMs(requested: number | undefined): number {
  const base = defaultPollIntervalMs();

  if (requested === undefined || Number.isNaN(requested)) {
    return base;
  }

  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, requested));
}

export interface DashboardStatusItemPayload {
  subscriptionId: string;
  itemId: string;
  service: 'controller' | 'manager';
  name: string;
  publicIp: string;
  privateIp?: string;
  status: string;
  metadata?: Record<string, unknown>;
  hostname?: string;
  hostnameFqdn?: string;
}

export interface DashboardStatusUpdatePayload {
  generatedAt: string;
  items: DashboardStatusItemPayload[];
}

interface SubscribeDashboardStatusPayload {
  pollIntervalMs?: number;
}

type BillingSocket = Socket & { data: { userInfo?: SocketUserInfo } };

/**
 * WebSocket gateway for billing status updates.
 * Handles WebSocket connections, authentication, and billing status updates.
 * Authenticates sessions exclusively against the database-backed billing management system.
 */
@WebSocketGateway(parseInt(process.env.WEBSOCKET_PORT || '8082', 10), {
  namespace: process.env.WEBSOCKET_NAMESPACE || 'billing',
  cors: {
    origin: process.env.WEBSOCKET_CORS_ORIGIN || '*',
  },
})
export class BillingStatusGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BillingStatusGateway.name);
  private readonly pollTimerBySocketId = new Map<string, ReturnType<typeof setInterval>>();
  private readonly tickInFlight = new Set<string>();

  constructor(
    private readonly socketAuthService: SocketAuthService,
    private readonly subscriptionService: SubscriptionService,
    private readonly subscriptionItemServerService: SubscriptionItemServerService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const authHeader = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.Authorization;
      const userInfo = await this.socketAuthService.validateAndGetUser(
        typeof authHeader === 'string' ? authHeader : undefined,
      );

      if (!userInfo) {
        this.logger.warn(`Billing WebSocket rejected: invalid authorization for socket ${socket.id}`);
        next(new Error('Unauthorized'));

        return;
      }

      (socket as BillingSocket).data = { userInfo };
      next();
    });
  }

  handleConnection(socket: Socket): void {
    this.logger.log(`Billing status client connected: ${socket.id}`);
  }

  handleDisconnect(socket: Socket): void {
    this.logger.log(`Billing status client disconnected: ${socket.id}`);
    this.clearPollTimer(socket.id);
    this.tickInFlight.delete(socket.id);
  }

  @SubscribeMessage('subscribeDashboardStatus')
  async handleSubscribe(
    @MessageBody() body: SubscribeDashboardStatusPayload | undefined,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const userInfo = (socket as BillingSocket).data?.userInfo;
    const userId = getBillingUserIdFromSocketUser(userInfo);

    if (!userId) {
      socket.emit('error', { message: 'User not authenticated' });

      return;
    }

    this.clearPollTimer(socket.id);
    const intervalMs = clampPollIntervalMs(body?.pollIntervalMs);

    await this.runStatusTick(socket as BillingSocket);

    const timer = setInterval(() => {
      void this.runStatusTick(socket as BillingSocket);
    }, intervalMs);

    this.pollTimerBySocketId.set(socket.id, timer);
  }

  @SubscribeMessage('unsubscribeDashboardStatus')
  handleUnsubscribe(@ConnectedSocket() socket: Socket): void {
    this.clearPollTimer(socket.id);
  }

  private clearPollTimer(socketId: string): void {
    const existing = this.pollTimerBySocketId.get(socketId);

    if (existing) {
      clearInterval(existing);
      this.pollTimerBySocketId.delete(socketId);
    }
  }

  private async runStatusTick(socket: BillingSocket): Promise<void> {
    if (this.tickInFlight.has(socket.id)) {
      return;
    }

    this.tickInFlight.add(socket.id);

    const userInfo = socket.data?.userInfo;
    const currentUserId = getBillingUserIdFromSocketUser(userInfo);

    if (!currentUserId) {
      this.tickInFlight.delete(socket.id);
      this.clearPollTimer(socket.id);
      socket.emit('error', { message: 'User not authenticated' });

      return;
    }

    try {
      const subscriptions = await this.subscriptionService.listSubscriptions(currentUserId, 1000, 0);
      const active = subscriptions.filter((s) => s.status === SubscriptionStatus.ACTIVE);
      const items: DashboardStatusItemPayload[] = [];

      for (const sub of active) {
        try {
          const subItems = await this.subscriptionItemServerService.listItems(sub.id, currentUserId);
          const activeItem = subItems.find((i) => i.provisioningStatus === 'active');

          if (!activeItem) {
            continue;
          }

          const info = await this.subscriptionItemServerService.getServerInfo(sub.id, activeItem.id, currentUserId);

          items.push({
            subscriptionId: sub.id,
            itemId: activeItem.id,
            service: activeItem.service ?? 'controller',
            name: info.name,
            publicIp: info.publicIp,
            privateIp: info.privateIp,
            status: info.status,
            metadata: info.metadata,
            hostname: info.hostname,
            hostnameFqdn: info.hostnameFqdn,
          });
        } catch (err) {
          this.logger.debug(`Skipping subscription ${sub.id} in status tick: ${(err as Error).message ?? err}`);
        }
      }

      const payload: DashboardStatusUpdatePayload = {
        generatedAt: new Date().toISOString(),
        items,
      };

      socket.emit('dashboardStatusUpdate', payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Status update failed';

      this.logger.warn(`Billing status tick failed for socket ${socket.id}: ${message}`);
      socket.emit('error', { message: 'Failed to load dashboard status' });
    } finally {
      this.tickInFlight.delete(socket.id);
    }
  }
}
