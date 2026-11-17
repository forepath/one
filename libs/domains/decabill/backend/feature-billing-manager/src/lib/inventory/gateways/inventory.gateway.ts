import {
  attachMachineSocketSession,
  SocketAuthService,
  socketRoomsForUser,
  type SocketUserInfo,
  UserRole,
} from '@forepath/identity/backend';
import { readIncomingTenantIdFromHandshake, runWithTenantId } from '@forepath/shared/backend';
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

import {
  BILLING_WEBSOCKETS,
  INVENTORY_SOCKET_INBOUND_SCOPES,
  INVENTORY_SOCKET_OUTBOUND_SCOPES,
} from '../../auth/billing-websocket.scopes';
import { InventoryWithdrawalRequestsRepository } from '../repositories/inventory-withdrawal-requests.repository';
import { INVENTORY_EVENTS } from '../services/inventory-realtime.constants';
import { InventoryRealtimeService } from '../services/inventory-realtime.service';

/** Poll interval of the request change marker (requests raised by worker processes), clamped to 5–120 s. */
function resolveRequestsPollIntervalMs(): number {
  const configured = Number(process.env.INVENTORY_REQUESTS_POLL_INTERVAL ?? 15000);

  return Math.min(120_000, Math.max(5_000, Number.isFinite(configured) ? configured : 15000));
}

type InventorySocket = Socket & { data: { userInfo?: SocketUserInfo; tenantId?: string } };

/**
 * Live inventory changes for administrators (warehouses, compartments, articles, stock, movements, requests).
 * Interactive admins join the tenant room on `subscribeInventory`; machine tokens additionally need
 * `websocket:inventory:read` + `inventory:admin` and only receive events their scopes permit.
 */
@WebSocketGateway({
  namespace: process.env.INVENTORY_WEBSOCKET_NAMESPACE || 'socket/inventory',
  cors: {
    origin: resolveWebsocketCorsOrigin(),
  },
})
export class InventoryGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(InventoryGateway.name);
  private readonly roomsBySocket = new Map<string, string[]>();
  /** Subscribed sockets per tenant (drives the request change poll). */
  private readonly subscribersByTenant = new Map<string, Set<string>>();
  private readonly lastSignatureByTenant = new Map<string, string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private readonly socketAuthService: SocketAuthService,
    private readonly inventoryRealtime: InventoryRealtimeService,
    private readonly requestsRepository: InventoryWithdrawalRequestsRepository,
  ) {}

  onModuleDestroy(): void {
    this.stopPolling();
  }

  afterInit(server: Server): void {
    this.inventoryRealtime.attachServer(server);
    server.use(async (socket, next) => {
      const authHeader = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.Authorization;
      const tenantId = readIncomingTenantIdFromHandshake(
        socket.handshake?.headers as Record<string, unknown> | undefined,
        socket.handshake?.auth as Record<string, unknown> | undefined,
      );

      if (!tenantId) {
        this.logger.warn(`Inventory WebSocket rejected: invalid tenant for socket ${socket.id}`);
        next(new Error('Invalid tenant'));

        return;
      }

      const header = typeof authHeader === 'string' ? authHeader : undefined;
      const authOptions = { websocket: BILLING_WEBSOCKETS.inventory, transportSocket: socket.request?.socket };
      const userInfo = await this.socketAuthService.validateAndGetUser(header, tenantId, authOptions);

      if (!userInfo) {
        this.logger.warn(`Inventory WebSocket rejected: invalid authorization for socket ${socket.id}`);
        next(new Error('Unauthorized'));

        return;
      }

      (socket as InventorySocket).data = { userInfo, tenantId };
      attachMachineSocketSession(socket, userInfo, {
        inboundEvents: INVENTORY_SOCKET_INBOUND_SCOPES,
        revalidate: () => this.socketAuthService.validateAndGetUser(header, tenantId, authOptions),
        logger: this.logger,
      });
      next();
    });
  }

  handleDisconnect(socket: Socket): void {
    this.forgetSubscriber(socket);
  }

  @SubscribeMessage('subscribeInventory')
  async handleSubscribe(@ConnectedSocket() socket: Socket): Promise<void> {
    const { userInfo, tenantId } = (socket as InventorySocket).data ?? {};

    // Inventory is admin-only, like its REST API (`@UsersRoles(ADMIN)`); API key sockets are not supported.
    if (!userInfo || userInfo.isApiKeyAuth || !tenantId) {
      socket.emit('error', { message: 'User not authenticated' });

      return;
    }

    if (userInfo.userRole !== UserRole.ADMIN) {
      socket.emit('error', { message: 'Access denied' });

      return;
    }

    if (this.roomsBySocket.has(socket.id)) {
      socket.emit('subscribeInventorySuccess', { message: 'Already subscribed' });

      return;
    }

    const rooms = socketRoomsForUser(
      userInfo,
      InventoryRealtimeService.tenantRoom(tenantId),
      INVENTORY_SOCKET_OUTBOUND_SCOPES,
    );

    for (const room of rooms) {
      await socket.join(room);
    }

    this.roomsBySocket.set(socket.id, rooms);
    this.rememberSubscriber(socket.id, tenantId);
    socket.emit('subscribeInventorySuccess', { message: 'Subscribed' });
  }

  @SubscribeMessage('unsubscribeInventory')
  async handleUnsubscribe(@ConnectedSocket() socket: Socket): Promise<void> {
    for (const room of this.roomsBySocket.get(socket.id) ?? []) {
      await socket.leave(room);
    }

    this.forgetSubscriber(socket);
  }

  private rememberSubscriber(socketId: string, tenantId: string): void {
    const sockets = this.subscribersByTenant.get(tenantId) ?? new Set<string>();

    sockets.add(socketId);
    this.subscribersByTenant.set(tenantId, sockets);

    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => void this.pollRequestChanges(), resolveRequestsPollIntervalMs());
      this.pollTimer.unref?.();
    }
  }

  private forgetSubscriber(socket: Socket): void {
    this.roomsBySocket.delete(socket.id);

    for (const [tenantId, sockets] of this.subscribersByTenant) {
      if (sockets.delete(socket.id) && sockets.size === 0) {
        this.subscribersByTenant.delete(tenantId);
        this.lastSignatureByTenant.delete(tenantId);
      }
    }

    if (this.subscribersByTenant.size === 0) {
      this.stopPolling();
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Emits `requestsChanged` to a tenant room when its request marker changed since the last poll. */
  async pollRequestChanges(): Promise<void> {
    if (this.polling) {
      return;
    }

    this.polling = true;

    try {
      for (const tenantId of [...this.subscribersByTenant.keys()]) {
        try {
          await runWithTenantId(tenantId, async () => {
            const { signature, pendingCount } = await this.requestsRepository.changeSignature(tenantId);
            const previous = this.lastSignatureByTenant.get(tenantId);

            this.lastSignatureByTenant.set(tenantId, signature);

            if (previous !== undefined && previous !== signature) {
              this.inventoryRealtime.emit(INVENTORY_EVENTS.requestsChanged, { pendingCount });
            }
          });
        } catch (error) {
          this.logger.warn(`Inventory request poll failed for tenant ${tenantId}: ${(error as Error).message}`);
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
