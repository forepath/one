import { Injectable } from '@nestjs/common';

import type { ProjectEntity } from '../entities/project.entity';
import { ProjectBoardRealtimeService } from './project-board-realtime.service';
import { PROJECTS_BOARD_EVENTS } from './project-board-realtime.constants';
import { ProjectsService } from './projects.service';

@Injectable()
export class ProjectBoardSummaryService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectBoardRealtime: ProjectBoardRealtimeService,
  ) {}

  async emitSummaryChanged(project: ProjectEntity): Promise<void> {
    const summary = await this.projectsService.buildSummary(project);

    this.projectBoardRealtime.emitToProject(project.id, PROJECTS_BOARD_EVENTS.projectSummaryChanged, summary);
  }
}
