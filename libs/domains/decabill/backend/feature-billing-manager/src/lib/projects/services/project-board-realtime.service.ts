import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import { PROJECTS_BOARD_EVENTS } from './project-board-realtime.constants';

/**
 * Emits project board events to the `projects` Socket.IO namespace.
 * The project board gateway calls `attachServer` during `afterInit`.
 */
@Injectable()
export class ProjectBoardRealtimeService {
  private readonly logger = new Logger(ProjectBoardRealtimeService.name);
  private server: Server | null = null;

  static projectRoom(projectId: string): string {
    return `project:${projectId}`;
  }

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Project board realtime attached to projects namespace server');
  }

  emitToProject(projectId: string, event: keyof typeof PROJECTS_BOARD_EVENTS | string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(`Skip emit ${event}: server not attached yet`);

      return;
    }

    const room = ProjectBoardRealtimeService.projectRoom(projectId);

    this.server.to(room).emit(event, payload);
  }
}
