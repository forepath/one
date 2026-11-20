import { socketBroadcastRooms } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import { getRequiredTenantId } from '../../utils/tenant-query.utils';

import type { InventoryEventName } from './inventory-realtime.constants';

/**
 * Emits inventory changes to the administrators of the current tenant on the `inventory` Socket.IO namespace.
 * The inventory gateway calls `attachServer` during `afterInit`; until then (and in workers) emits are no-ops.
 */
@Injectable()
export class InventoryRealtimeService {
  private readonly logger = new Logger(InventoryRealtimeService.name);
  private server: Server | null = null;

  static tenantRoom(tenantId: string): string {
    return `inventory:${tenantId}`;
  }

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Inventory realtime attached to inventory namespace server');
  }

  emit(event: InventoryEventName, payload: unknown): void {
    if (!this.server) {
      return;
    }

    const room = InventoryRealtimeService.tenantRoom(getRequiredTenantId());

    // Per-event rooms reach PAT / app token sockets permitted to receive this event.
    this.server.to(socketBroadcastRooms(room, event)).emit(event, payload);
  }
}
