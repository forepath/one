import { Injectable, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

import type { TicketResponseDto } from '../dto/tickets';

import { CLIENT_CHAT_AUTOMATION_EVENTS } from './client-chat-automation.constants';
import { TicketBoardRealtimeService } from './ticket-board-realtime.service';

/**
 * Emits ticket-automation chat timeline events on the **clients** Socket.IO namespace
 * (distinct from {@link TicketBoardRealtimeService}, which uses the `tickets` namespace).
 */
@Injectable()
export class ClientAutomationChatRealtimeService {
  private readonly logger = new Logger(ClientAutomationChatRealtimeService.name);
  private server: Server | null = null;

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Client automation chat realtime attached to clients namespace server');
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
    this.emitToClientRoom(clientId, CLIENT_CHAT_AUTOMATION_EVENTS.ticketAutomationRunChatUpsert, payload);
  }

  emitTicketChatUpsert(clientId: string, ticket: TicketResponseDto): void {
    this.emitToClientRoom(clientId, CLIENT_CHAT_AUTOMATION_EVENTS.ticketChatTicketUpsert, ticket);
  }

  emitToSocket(socket: Socket, payload: unknown): void {
    if (!socket.connected) {
      return;
    }

    try {
      socket.emit(CLIENT_CHAT_AUTOMATION_EVENTS.ticketAutomationRunChatUpsert, payload);
    } catch (err) {
      this.logger.warn(`emitToSocket failed: ${err}`);
    }
  }
}
