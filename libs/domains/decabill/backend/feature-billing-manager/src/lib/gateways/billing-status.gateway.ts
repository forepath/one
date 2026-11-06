import {
  attachMachineSocketSession,
  getMissingPatScopes,
  isMachineSocketUser,
  SocketAuthService,
  socketRoomsForUser,
  UserRole,
  type SocketUserInfo,
} from '@forepath/identity/backend';
import { UsersRepository } from '@forepath/identity/backend';
import { getOrInitSocketTenantId, readIncomingTenantIdFromHandshake, runWithTenantId } from '@forepath/shared/backend';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
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

import {
  BILLING_SOCKET_ADMIN_METERS_SCOPE,
  BILLING_SOCKET_INBOUND_SCOPES,
  BILLING_SOCKET_OUTBOUND_SCOPES,
  BILLING_WEBSOCKETS,
} from '../auth/billing-websocket.scopes';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { SubscriptionItemServerService } from '../services/subscription-item-server.service';
import { SubscriptionService } from '../services/subscription.service';
import { getBillingUserIdFromSocketUser } from '../utils/billing-socket-user.utils';
import { isLiveAccessibleSubscriptionStatus } from '../utils/subscription-live-access.utils';
import { BillingMeterRealtimeService } from './billing-meter-realtime.service';
import {
  canonicalizeCloudInitService,
  CloudInitServiceType,
} from '../utils/cloud-init/integrated-provisioning-service';

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
  service: CloudInitServiceType;
  /** User-facing service type name from the catalog. */
  serviceTypeName: string;
  /** Customer-defined label; null when unset. */
  displayName: string | null;
  name: string;
  publicIp: string;
  privateIp?: string;
  status: string;
  metadata?: Record<string, unknown>;
  hostname?: string;
  hostnameFqdn?: string;
  sshAccessGranted: boolean;
}

export interface DashboardStatusUpdatePayload {
  generatedAt: string;
  items: DashboardStatusItemPayload[];
}

interface SubscribeDashboardStatusPayload {
  pollIntervalMs?: number;
}

interface SubscribeSubscriptionMetersPayload {
  subscriptionId?: string;
}

type BillingSocket = Socket & {
  data: {
    userInfo?: SocketUserInfo;
    tenantId?: string;
    meterSubscriptionRooms?: string[];
  };
};

/**
 * WebSocket gateway for billing status updates.
 * Handles WebSocket connections, authentication, and billing status updates.
 * Authenticates sessions exclusively against the database-backed billing management system.
 */
@WebSocketGateway({
  namespace: process.env.WEBSOCKET_NAMESPACE || 'socket/billing',
  cors: {
    origin: resolveWebsocketCorsOrigin(),
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
    private readonly usersRepository: UsersRepository,
    private readonly billingMeterRealtime: BillingMeterRealtimeService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
  ) {}

  afterInit(server: Server): void {
    this.billingMeterRealtime.attachServer(server);
    server.use(async (socket, next) => {
      const authHeader = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.Authorization;
      const tenantId = readIncomingTenantIdFromHandshake(
        socket.handshake?.headers as Record<string, unknown> | undefined,
        socket.handshake?.auth as Record<string, unknown> | undefined,
      );

      if (!tenantId) {
        this.logger.warn(`Billing WebSocket rejected: invalid tenant for socket ${socket.id}`);
        next(new Error('Invalid tenant'));

        return;
      }

      const header = typeof authHeader === 'string' ? authHeader : undefined;
      const authOptions = { websocket: BILLING_WEBSOCKETS.billing };
      const userInfo = await this.socketAuthService.validateAndGetUser(header, tenantId, authOptions);

      if (!userInfo) {
        this.logger.warn(`Billing WebSocket rejected: invalid authorization for socket ${socket.id}`);
        next(new Error('Unauthorized'));

        return;
      }

      (socket as BillingSocket).data = { userInfo, tenantId };
      // PAT / app tokens: per-event scopes and live session re-checks (no-op for interactive sessions).
      attachMachineSocketSession(socket, userInfo, {
        inboundEvents: BILLING_SOCKET_INBOUND_SCOPES,
        revalidate: () => this.socketAuthService.validateAndGetUser(header, tenantId, authOptions),
        logger: this.logger,
      });
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
    this.leaveMeterRooms(socket as BillingSocket);
  }

  @SubscribeMessage('subscribeDashboardStatus')
  async handleSubscribe(
    @MessageBody() body: SubscribeDashboardStatusPayload | undefined,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const billingSocket = socket as BillingSocket;
    const tenantId = this.resolveSocketTenantId(billingSocket);

    if (!tenantId) {
      socket.emit('error', { message: 'Access denied' });

      return;
    }

    await runWithTenantId(tenantId, async () => {
      const userInfo = billingSocket.data?.userInfo;
      const userId = getBillingUserIdFromSocketUser(userInfo);

      if (!userId) {
        socket.emit('error', { message: 'User not authenticated' });

        return;
      }

      const user = await this.usersRepository.findByIdForTenant(userId);

      if (!user || user.tenantId !== tenantId) {
        socket.emit('error', { message: 'Access denied' });

        return;
      }

      this.clearPollTimer(socket.id);
      const intervalMs = clampPollIntervalMs(body?.pollIntervalMs);

      await this.runStatusTick(billingSocket);

      const timer = setInterval(() => {
        void this.runStatusTick(billingSocket);
      }, intervalMs);

      this.pollTimerBySocketId.set(socket.id, timer);
    });
  }

  @SubscribeMessage('unsubscribeDashboardStatus')
  handleUnsubscribe(@ConnectedSocket() socket: Socket): void {
    this.clearPollTimer(socket.id);
  }

  @SubscribeMessage('subscribeSubscriptionMeters')
  async handleSubscribeMeters(
    @MessageBody() body: SubscribeSubscriptionMetersPayload | undefined,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const subscriptionId = body?.subscriptionId;

    if (!subscriptionId) {
      socket.emit('error', { message: 'subscriptionId is required' });

      return;
    }

    const billingSocket = socket as BillingSocket;
    const tenantId = this.resolveSocketTenantId(billingSocket);

    if (!tenantId) {
      socket.emit('error', { message: 'Access denied' });

      return;
    }

    await runWithTenantId(tenantId, async () => {
      const userInfo = billingSocket.data?.userInfo;
      const userId = getBillingUserIdFromSocketUser(userInfo);

      if (!userId) {
        socket.emit('error', { message: 'User not authenticated' });

        return;
      }

      try {
        if (this.mayWatchAnySubscription(userInfo)) {
          // Admins may watch any subscription in their handshake tenant without ownership.
          await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
        } else {
          await this.subscriptionService.getSubscription(subscriptionId, userId);
        }
      } catch {
        socket.emit('error', { message: 'Access denied' });

        return;
      }

      const room = BillingMeterRealtimeService.subscriptionRoom(subscriptionId);

      // PAT / app token sockets join only the per-event rooms they may receive.
      for (const target of socketRoomsForUser(userInfo, room, BILLING_SOCKET_OUTBOUND_SCOPES)) {
        await socket.join(target);
        this.trackMeterRoom(billingSocket, target);
      }

      const payload = await this.billingMeterRealtime.buildMeterSummaryPayload(subscriptionId);

      if (payload) {
        socket.emit('meterSummaryUpdate', payload);
      }
    });
  }

  @SubscribeMessage('unsubscribeSubscriptionMeters')
  async handleUnsubscribeMeters(
    @MessageBody() body: SubscribeSubscriptionMetersPayload | undefined,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const subscriptionId = body?.subscriptionId;

    if (!subscriptionId) {
      return;
    }

    const room = BillingMeterRealtimeService.subscriptionRoom(subscriptionId);
    const billingSocket = socket as BillingSocket;

    for (const target of socketRoomsForUser(billingSocket.data?.userInfo, room, BILLING_SOCKET_OUTBOUND_SCOPES)) {
      await socket.leave(target);
      this.untrackMeterRoom(billingSocket, target);
    }
  }

  /**
   * Interactive admins may watch any subscription; PAT / app tokens of admins only with the admin meters scope
   * (same as the admin meters REST API). Everyone else is limited to owned subscriptions.
   */
  private mayWatchAnySubscription(userInfo: SocketUserInfo | undefined): boolean {
    if (userInfo?.userRole !== UserRole.ADMIN) {
      return false;
    }

    if (!isMachineSocketUser(userInfo)) {
      return true;
    }

    return getMissingPatScopes(userInfo.scopes ?? [], [BILLING_SOCKET_ADMIN_METERS_SCOPE]).length === 0;
  }

  private clearPollTimer(socketId: string): void {
    const existing = this.pollTimerBySocketId.get(socketId);

    if (existing) {
      clearInterval(existing);
      this.pollTimerBySocketId.delete(socketId);
    }
  }

  private resolveSocketTenantId(socket: BillingSocket): string | undefined {
    return socket.data?.tenantId ?? getOrInitSocketTenantId(socket);
  }

  private async runStatusTick(socket: BillingSocket): Promise<void> {
    if (this.tickInFlight.has(socket.id)) {
      return;
    }

    this.tickInFlight.add(socket.id);

    const tenantId = this.resolveSocketTenantId(socket);

    if (!tenantId) {
      this.tickInFlight.delete(socket.id);
      this.clearPollTimer(socket.id);
      socket.emit('error', { message: 'Access denied' });

      return;
    }

    await runWithTenantId(tenantId, async () => {
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
        const accessible = subscriptions.filter((s) => isLiveAccessibleSubscriptionStatus(s.status));
        const items: DashboardStatusItemPayload[] = [];

        for (const sub of accessible) {
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
              service: canonicalizeCloudInitService(activeItem.service),
              serviceTypeName: activeItem.serviceTypeName,
              displayName: activeItem.displayName ?? null,
              name: info.name,
              publicIp: info.publicIp,
              privateIp: info.privateIp,
              status: info.status,
              metadata: info.metadata,
              hostname: info.hostname,
              hostnameFqdn: info.hostnameFqdn,
              sshAccessGranted: activeItem.sshAccessGranted === true,
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
    });
  }

  private trackMeterRoom(socket: BillingSocket, room: string): void {
    const rooms = socket.data.meterSubscriptionRooms ?? [];

    if (!rooms.includes(room)) {
      socket.data.meterSubscriptionRooms = [...rooms, room];
    }
  }

  private untrackMeterRoom(socket: BillingSocket, room: string): void {
    const rooms = socket.data.meterSubscriptionRooms;

    if (!rooms) {
      return;
    }

    socket.data.meterSubscriptionRooms = rooms.filter((entry) => entry !== room);
  }

  private leaveMeterRooms(socket: BillingSocket): void {
    const rooms = socket.data.meterSubscriptionRooms ?? [];

    for (const room of rooms) {
      void socket.leave(room);
    }

    socket.data.meterSubscriptionRooms = [];
  }
}
