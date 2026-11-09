import { socketBroadcastRooms } from '@forepath/identity/backend';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Server } from 'socket.io';

import { INITIATIVES_BOARD_EVENTS, type InitiativesBoardEvent } from './initiative-board-realtime.constants';
import { WorkspaceGraphChangeNotifierService } from './workspace-graph-change-notifier.service';

/** Events that change a workspace's graph snapshot (initiatives, documents, work items; not runs or activity). */
const GRAPH_EVENTS: ReadonlySet<string> = new Set([
  INITIATIVES_BOARD_EVENTS.initiativeUpsert,
  INITIATIVES_BOARD_EVENTS.initiativeRemoved,
  INITIATIVES_BOARD_EVENTS.initiativeArtifactUpsert,
  INITIATIVES_BOARD_EVENTS.initiativeArtifactRemoved,
  INITIATIVES_BOARD_EVENTS.initiativeWorkItemsChanged,
]);

/**
 * Emits Initiatives board events to the `initiatives` Socket.IO namespace (room `client:{clientId}`), like the ticket
 * and knowledge boards. The gateway calls `attachServer` during `afterInit`.
 */
@Injectable()
export class InitiativeBoardRealtimeService {
  private readonly logger = new Logger(InitiativeBoardRealtimeService.name);
  private server: Server | null = null;

  constructor(@Optional() private readonly graphChanges?: WorkspaceGraphChangeNotifierService) {}

  static clientRoom(clientId: string): string {
    return `client:${clientId}`;
  }

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Initiatives board realtime attached to initiatives namespace server');
  }

  emitToClient(clientId: string, event: InitiativesBoardEvent, payload: unknown): void {
    // Every initiative write emits here (also in processes without a socket server): keep the graphs current.
    if (GRAPH_EVENTS.has(event)) {
      this.graphChanges?.notify(clientId, event);
    }

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
