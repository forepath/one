import { socketBroadcastRooms } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import { TICKETS_BOARD_EVENTS } from './ticket-board-realtime.constants';

/**
 * Emits ticket board / automation events to the `tickets` Socket.IO namespace.
 * The tickets gateway calls `attachServer` during `afterInit`.
 */
/** A ticket of a workspace changed (upsert) or left it (removed); observers react without a socket. */
export type TicketBoardChangeListener = (change: { clientId: string; ticketId: string; removed: boolean }) => void;

@Injectable()
export class TicketBoardRealtimeService {
  private readonly logger = new Logger(TicketBoardRealtimeService.name);
  private server: Server | null = null;
  private readonly changeListeners = new Set<TicketBoardChangeListener>();

  static clientRoom(clientId: string): string {
    return `client:${clientId}`;
  }

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Ticket board realtime attached to tickets namespace server');
  }

  /**
   * Observe ticket changes. Every ticket write (REST, agents, automation, imports, migration) publishes its board
   * snapshot through {@link emitToClient}, which makes it the single point for in-process observers (Initiatives).
   */
  onTicketChange(listener: TicketBoardChangeListener): () => void {
    this.changeListeners.add(listener);

    return () => this.changeListeners.delete(listener);
  }

  emitToClient(clientId: string, event: keyof typeof TICKETS_BOARD_EVENTS | string, payload: unknown): void {
    this.notifyChangeListeners(clientId, event, payload);

    if (!this.server) {
      this.logger.debug(`Skip emit ${event}: server not attached yet`);

      return;
    }

    const room = TicketBoardRealtimeService.clientRoom(clientId);

    // Per-event rooms reach PAT / app token sockets permitted to receive this event.
    this.server.to(socketBroadcastRooms(room, event)).emit(event, payload);
  }

  private notifyChangeListeners(clientId: string, event: string, payload: unknown): void {
    if (
      this.changeListeners.size === 0 ||
      (event !== TICKETS_BOARD_EVENTS.ticketUpsert && event !== TICKETS_BOARD_EVENTS.ticketRemoved)
    ) {
      return;
    }

    const ticketId = (payload as { id?: unknown } | null)?.id;

    if (typeof ticketId !== 'string') {
      return;
    }

    for (const listener of this.changeListeners) {
      try {
        listener({ clientId, ticketId, removed: event === TICKETS_BOARD_EVENTS.ticketRemoved });
      } catch (error) {
        this.logger.warn(`Ticket change listener failed: ${(error as Error).message}`);
      }
    }
  }
}
