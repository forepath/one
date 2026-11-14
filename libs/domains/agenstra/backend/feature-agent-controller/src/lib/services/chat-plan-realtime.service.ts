import { emitToSocketIfPermitted, socketBroadcastRooms } from '@forepath/identity/backend';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

import { CLIENTS_SOCKET_OUTBOUND_SCOPES } from '../auth/agenstra-websocket.scopes';

import { CLIENT_CHAT_PLAN_EVENTS } from './client-chat-plan.constants';
import { TicketBoardRealtimeService } from './ticket-board-realtime.service';
import { WorkspaceGraphChangeNotifierService } from './workspace-graph-change-notifier.service';

/**
 * Emits chat-plan timeline events on the **clients** Socket.IO namespace.
 */
@Injectable()
export class ChatPlanRealtimeService {
  private readonly logger = new Logger(ChatPlanRealtimeService.name);
  private server: Server | null = null;

  constructor(@Optional() private readonly graphChanges?: WorkspaceGraphChangeNotifierService) {}

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

    this.server.to(socketBroadcastRooms(room, event)).emit(event, payload);
  }

  emitToClient(clientId: string, payload: unknown): void {
    // Plan upserts are part of the workspace graph (also when emitted by worker processes).
    this.graphChanges?.notify(clientId, CLIENT_CHAT_PLAN_EVENTS.chatPlanUpsert);
    this.emitToClientRoom(clientId, CLIENT_CHAT_PLAN_EVENTS.chatPlanUpsert, payload);
  }

  emitToSocket(socket: Socket, payload: unknown): void {
    if (!socket.connected) {
      return;
    }

    try {
      emitToSocketIfPermitted(socket, CLIENT_CHAT_PLAN_EVENTS.chatPlanUpsert, CLIENTS_SOCKET_OUTBOUND_SCOPES, payload);
    } catch (err) {
      this.logger.warn(`emitToSocket failed: ${err}`);
    }
  }
}
