import { Injectable, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

import { AGENT_TASK_SOCKET_EVENTS } from '../constants/agent-tasks.constants';
import type { AgentTaskRemovedEventDto, AgentTaskResponseDto, AgentTaskRunChatEventDto } from '../dto/agent-tasks';

import { TicketBoardRealtimeService } from './ticket-board-realtime.service';

/**
 * Emits agent task events on the **clients** Socket.IO namespace, scoped to the workspace room that only
 * sockets with access to the workspace join.
 */
@Injectable()
export class AgentTaskRealtimeService {
  private readonly logger = new Logger(AgentTaskRealtimeService.name);
  private server: Server | null = null;

  attachServer(server: Server): void {
    this.server = server;
  }

  emitRunChatUpsert(clientId: string, payload: AgentTaskRunChatEventDto): void {
    this.emitToClientRoom(clientId, AGENT_TASK_SOCKET_EVENTS.runChatUpsert, payload);
  }

  emitRunChatUpsertToSocket(socket: Socket, payload: AgentTaskRunChatEventDto): void {
    if (!socket.connected) {
      return;
    }

    try {
      socket.emit(AGENT_TASK_SOCKET_EVENTS.runChatUpsert, payload);
    } catch (err) {
      this.logger.warn(`emitRunChatUpsertToSocket failed: ${err}`);
    }
  }

  emitTaskUpsert(task: AgentTaskResponseDto): void {
    this.emitToClientRoom(task.clientId, AGENT_TASK_SOCKET_EVENTS.taskUpsert, task);
  }

  emitTaskRemoved(payload: AgentTaskRemovedEventDto): void {
    this.emitToClientRoom(payload.clientId, AGENT_TASK_SOCKET_EVENTS.taskRemoved, payload);
  }

  private emitToClientRoom(clientId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(`Skip ${event}: server not attached`);

      return;
    }

    this.server.to(TicketBoardRealtimeService.clientRoom(clientId)).emit(event, payload);
  }
}
