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

    this.server.to(KnowledgeBoardRealtimeService.clientRoom(clientId)).emit(event, payload);
  }
}
