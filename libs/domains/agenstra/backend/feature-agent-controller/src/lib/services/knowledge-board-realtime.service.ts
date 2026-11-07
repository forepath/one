import { socketBroadcastRooms } from '@forepath/identity/backend';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Server } from 'socket.io';

import { KNOWLEDGE_BOARD_EVENTS } from './knowledge-board-realtime.constants';
import { WorkspaceGraphChangeNotifierService } from './workspace-graph-change-notifier.service';

/** Events that change a workspace's graph snapshot (pages / relations; not activity entries). */
const GRAPH_EVENTS: ReadonlySet<string> = new Set([
  KNOWLEDGE_BOARD_EVENTS.knowledgeTreeChanged,
  KNOWLEDGE_BOARD_EVENTS.knowledgeRelationChanged,
]);

@Injectable()
export class KnowledgeBoardRealtimeService {
  private readonly logger = new Logger(KnowledgeBoardRealtimeService.name);
  private server: Server | null = null;

  constructor(@Optional() private readonly graphChanges?: WorkspaceGraphChangeNotifierService) {}

  static clientRoom(clientId: string): string {
    return `client:${clientId}`;
  }

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Knowledge board realtime attached to pages namespace server');
  }

  emitToClient(clientId: string, event: keyof typeof KNOWLEDGE_BOARD_EVENTS | string, payload: unknown): void {
    // Every knowledge write emits here (also in processes without a socket server): keep the graphs current.
    if (GRAPH_EVENTS.has(event)) {
      this.graphChanges?.notify(clientId, event);
    }

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
