import {
  DEPLOYMENT_SOCKET_EVENTS,
  type DeploymentRunSummary,
  type DeploymentWorkflowRemovedPayload,
  type DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { socketBroadcastRooms } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import { TicketBoardRealtimeService } from './ticket-board-realtime.service';

/**
 * Emits workspace deployment events (workflows, runs) on the **clients** Socket.IO namespace, scoped to the workspace
 * room that only sockets with access to the workspace join (`deployments:read` for machine tokens).
 */
@Injectable()
export class DeploymentRealtimeService {
  private readonly logger = new Logger(DeploymentRealtimeService.name);
  private server: Server | null = null;

  attachServer(server: Server): void {
    this.server = server;
  }

  emitWorkflowUpsert(workflow: DeploymentWorkflowSummary): void {
    this.emitToClientRoom(workflow.clientId, DEPLOYMENT_SOCKET_EVENTS.workflowUpsert, workflow);
  }

  emitWorkflowRemoved(payload: DeploymentWorkflowRemovedPayload): void {
    this.emitToClientRoom(payload.clientId, DEPLOYMENT_SOCKET_EVENTS.workflowRemoved, payload);
  }

  emitRunUpsert(run: DeploymentRunSummary): void {
    this.emitToClientRoom(run.clientId, DEPLOYMENT_SOCKET_EVENTS.runUpsert, run);
  }

  private emitToClientRoom(clientId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(`Skip ${event}: server not attached`);

      return;
    }

    this.server.to(socketBroadcastRooms(TicketBoardRealtimeService.clientRoom(clientId), event)).emit(event, payload);
  }
}
