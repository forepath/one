import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import { TICKETS_BOARD_EVENTS } from './ticket-board-realtime.constants';

/**
 * Emits ticket board / automation events to the `tickets` Socket.IO namespace.
 * The tickets gateway calls `attachServer` during `afterInit`.
 */
@Injectable()
export class TicketBoardRealtimeService {
  private readonly logger = new Logger(TicketBoardRealtimeService.name);
  private server: Server | null = null;

  static clientRoom(clientId: string): string {
    return `client:${clientId}`;
  }

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Ticket board realtime attached to tickets namespace server');
  }

  emitToClient(clientId: string, event: keyof typeof TICKETS_BOARD_EVENTS | string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(`Skip emit ${event}: server not attached yet`);

      return;
    }

    const room = TicketBoardRealtimeService.clientRoom(clientId);

    this.server.to(room).emit(event, payload);
  }
}
