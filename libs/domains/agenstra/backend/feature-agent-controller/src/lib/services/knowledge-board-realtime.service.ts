import { socketBroadcastRooms } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import { KNOWLEDGE_BOARD_EVENTS } from './knowledge-board-realtime.constants';

@Injectable()
export class KnowledgeBoardRealtimeService {
  private readonly logger = new Logger(KnowledgeBoardRealtimeService.name);
  private server: Server | null = null;

  static clientRoom(clientId: string): string {
    return `client:${clientId}`;
  }

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Knowledge board realtime attached to pages namespace server');
  }

  emitToClient(clientId: string, event: keyof typeof KNOWLEDGE_BOARD_EVENTS | string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(`Skip emit ${event}: server not attached yet`);

      return;
    }

    // Per-event rooms reach PAT / app token sockets permitted to receive this event.
    this.server
      .to(socketBroadcastRooms(KnowledgeBoardRealtimeService.clientRoom(clientId), event))
      .emit(event, payload);
  }
}
