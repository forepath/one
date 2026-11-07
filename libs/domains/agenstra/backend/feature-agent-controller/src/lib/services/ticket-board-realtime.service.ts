import { socketBroadcastRooms } from '@forepath/identity/backend';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Server } from 'socket.io';

import { TICKETS_BOARD_EVENTS } from './ticket-board-realtime.constants';
import { WorkspaceGraphChangeNotifierService } from './workspace-graph-change-notifier.service';

/** Events that change a workspace's graph snapshot (tickets and their relations; not comments, activity, runs). */
const GRAPH_EVENTS: ReadonlySet<string> = new Set([
  TICKETS_BOARD_EVENTS.ticketUpsert,
  TICKETS_BOARD_EVENTS.ticketRemoved,
  TICKETS_BOARD_EVENTS.knowledgeRelationChanged,
]);

/**
 * Emits ticket board / automation events to the `tickets` Socket.IO namespace.
 * The tickets gateway calls `attachServer` during `afterInit`.
 */
@Injectable()
export class TicketBoardRealtimeService {
  private readonly logger = new Logger(TicketBoardRealtimeService.name);
  private server: Server | null = null;

  constructor(@Optional() private readonly graphChanges?: WorkspaceGraphChangeNotifierService) {}

  static clientRoom(clientId: string): string {
    return `client:${clientId}`;
  }

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Ticket board realtime attached to tickets namespace server');
  }

  emitToClient(clientId: string, event: keyof typeof TICKETS_BOARD_EVENTS | string, payload: unknown): void {
    // Every ticket write emits here (also in worker processes without a socket server): keep the graphs current.
    if (GRAPH_EVENTS.has(event)) {
      this.graphChanges?.notify(clientId, event);
    }

    if (!this.server) {
      this.logger.debug(`Skip emit ${event}: server not attached yet`);

      return;
    }

    const room = TicketBoardRealtimeService.clientRoom(clientId);

    // Per-event rooms reach PAT / app token sockets permitted to receive this event.
    this.server.to(socketBroadcastRooms(room, event)).emit(event, payload);
  }
}
