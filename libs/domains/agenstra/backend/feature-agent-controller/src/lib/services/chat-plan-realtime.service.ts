import { Injectable, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

import { TicketBoardRealtimeService } from './ticket-board-realtime.service';
import { CLIENT_CHAT_PLAN_EVENTS } from './client-chat-plan.constants';

/**
 * Emits chat-plan timeline events on the **clients** Socket.IO namespace.
 */
@Injectable()
export class ChatPlanRealtimeService {
  private readonly logger = new Logger(ChatPlanRealtimeService.name);
  private server: Server | null = null;

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Chat plan realtime attached to clients namespace server');
  }

  private emitToClientRoom(clientId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(`Skip ${event}: server not attached`);

      return;
    }

    const room = TicketBoardRealtimeService.clientRoom(clientId);

    this.server.to(room).emit(event, payload);
  }

  emitToClient(clientId: string, payload: unknown): void {
    this.emitToClientRoom(clientId, CLIENT_CHAT_PLAN_EVENTS.chatPlanUpsert, payload);
  }

  emitToSocket(socket: Socket, payload: unknown): void {
    if (!socket.connected) {
      return;
    }

    try {
      socket.emit(CLIENT_CHAT_PLAN_EVENTS.chatPlanUpsert, payload);
    } catch (err) {
      this.logger.warn(`emitToSocket failed: ${err}`);
    }
  }
}
