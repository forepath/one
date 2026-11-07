import { socketBroadcastRooms } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import type { InitiativesBoardEvent } from './initiative-board-realtime.constants';

/**
 * Emits Initiatives board events to the `initiatives` Socket.IO namespace (room `client:{clientId}`), like the ticket
 * and knowledge boards. The gateway calls `attachServer` during `afterInit`.
 */
@Injectable()
export class InitiativeBoardRealtimeService {
  private readonly logger = new Logger(InitiativeBoardRealtimeService.name);
  private server: Server | null = null;

  static clientRoom(clientId: string): string {
    return `client:${clientId}`;
  }

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Initiatives board realtime attached to initiatives namespace server');
  }

  emitToClient(clientId: string, event: InitiativesBoardEvent, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(`Skip emit ${event}: server not attached yet`);

      return;
    }

    // Per-event rooms reach PAT / app token sockets permitted to receive this event.
    this.server
      .to(socketBroadcastRooms(InitiativeBoardRealtimeService.clientRoom(clientId), event))
      .emit(event, payload);
  }
}
