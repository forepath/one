import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import type { UserInfoFromRequest } from '../../utils/billing-access.utils';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';
import type {
  CreateProjectTimeEntryDto,
  PaginatedProjectTimeEntriesResponseDto,
  ProjectTimeEntryResponseDto,
  UpdateProjectTimeEntryDto,
} from '../dto/project-time-entry.dto';
import type { ProjectTimeEntryEntity } from '../entities/project-time-entry.entity';
import type { ProjectEntity } from '../entities/project.entity';
import { ProjectTicketsRepository } from '../repositories/project-tickets.repository';
import { ProjectTimeEntriesRepository } from '../repositories/project-time-entries.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import { resolveProjectTimeEntryRange } from '../utils/project-time-entry-range.utils';
import { ensureProjectAdmin, ensureProjectReadable } from '../utils/project-access.utils';
import { ProjectBoardRealtimeService } from './project-board-realtime.service';
import { PROJECTS_BOARD_EVENTS } from './project-board-realtime.constants';
import { ProjectsService } from './projects.service';

@Injectable()
export class ProjectTimeEntriesService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly timeEntriesRepository: ProjectTimeEntriesRepository,
    private readonly ticketsRepository: ProjectTicketsRepository,
    private readonly projectBoardRealtime: ProjectBoardRealtimeService,
    private readonly projectsService: ProjectsService,
  ) {}

  async list(
    projectId: string,
    limit: number,
    offset: number,
    userInfo: UserInfoFromRequest,
  ): Promise<PaginatedProjectTimeEntriesResponseDto> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);

    ensureProjectReadable(userInfo, project);

    const { items, total } = await this.timeEntriesRepository.findAllByProject(projectId, limit, offset);

    return {
      items: items.map((e) => this.mapEntry(e)),
      total,
      limit,
      offset,
    };
  }

  async create(
    projectId: string,
    dto: CreateProjectTimeEntryDto,
    req: RequestWithUser,
  ): Promise<ProjectTimeEntryResponseDto> {
    const userInfo = getUserFromRequest(req);
    const project = await this.projectsRepository.findByIdOrThrow(projectId);

    ensureProjectAdmin(userInfo);
    ensureProjectReadable(userInfo, project);

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    if (dto.ticketId) {
      const ticket = await this.ticketsRepository.findByIdOrThrow(dto.ticketId);

      if (ticket.projectId !== projectId) {
        throw new ForbiddenException('Ticket does not belong to project');
      }
    }

    const range = resolveProjectTimeEntryRange(new Date(dto.startedAt), new Date(dto.endedAt));

    const entry = await this.timeEntriesRepository.create({
      projectId,
      ticketId: dto.ticketId ?? null,
      recordedByUserId: userInfo.userId,
      durationMinutes: range.durationMinutes,
      description: dto.description?.trim() ?? null,
      startedAt: range.startedAt,
      endedAt: range.endedAt,
      recordedAt: range.recordedAt,
    });

    const mapped = this.mapEntry(entry);

    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.timeEntryUpsert, mapped);

    await this.emitSummaryChanged(project);

    return mapped;
  }

  async update(
    projectId: string,
    entryId: string,
    dto: UpdateProjectTimeEntryDto,
    req: RequestWithUser,
  ): Promise<ProjectTimeEntryResponseDto> {
    const userInfo = getUserFromRequest(req);
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const entry = await this.timeEntriesRepository.findByIdOrThrow(entryId);

    if (entry.projectId !== projectId) {
      throw new ForbiddenException('Time entry does not belong to project');
    }

    ensureProjectAdmin(userInfo);
    ensureProjectReadable(userInfo, project);

    if (entry.billedAt) {
      throw new BadRequestException('Cannot update billed time entry');
    }

    if (dto.ticketId) {
      const ticket = await this.ticketsRepository.findByIdOrThrow(dto.ticketId);

      if (ticket.projectId !== projectId) {
        throw new ForbiddenException('Ticket does not belong to project');
      }
    }

    const patch: Partial<ProjectTimeEntryEntity> = {
      ticketId: dto.ticketId,
      description: dto.description,
    };

    if (dto.startedAt !== undefined || dto.endedAt !== undefined) {
      if (!dto.startedAt || !dto.endedAt) {
        throw new BadRequestException('Both start and end time are required when updating the range');
      }

      const range = resolveProjectTimeEntryRange(new Date(dto.startedAt), new Date(dto.endedAt));

      patch.startedAt = range.startedAt;
      patch.endedAt = range.endedAt;
      patch.durationMinutes = range.durationMinutes;
      patch.recordedAt = range.recordedAt;
    }

    const updated = await this.timeEntriesRepository.update(entryId, patch);

    const mapped = this.mapEntry(updated);

    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.timeEntryUpsert, mapped);

    await this.emitSummaryChanged(project);

    return mapped;
  }

  async delete(projectId: string, entryId: string, req: RequestWithUser): Promise<void> {
    const userInfo = getUserFromRequest(req);
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const entry = await this.timeEntriesRepository.findByIdOrThrow(entryId);

    if (entry.projectId !== projectId) {
      throw new ForbiddenException('Time entry does not belong to project');
    }

    ensureProjectAdmin(userInfo);
    ensureProjectReadable(userInfo, project);

    if (entry.billedAt) {
      throw new BadRequestException('Cannot delete billed time entry');
    }

    await this.timeEntriesRepository.delete(entryId);

    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.timeEntryRemoved, {
      id: entryId,
      projectId,
    });

    await this.emitSummaryChanged(project);
  }

  private async emitSummaryChanged(project: ProjectEntity): Promise<void> {
    const summary = await this.projectsService.buildSummary(project);

    this.projectBoardRealtime.emitToProject(project.id, PROJECTS_BOARD_EVENTS.projectSummaryChanged, summary);
  }

  private mapEntry(entry: ProjectTimeEntryEntity): ProjectTimeEntryResponseDto {
    return {
      id: entry.id,
      projectId: entry.projectId,
      ticketId: entry.ticketId,
      recordedByUserId: entry.recordedByUserId,
      durationMinutes: entry.durationMinutes,
      description: entry.description,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      recordedAt: entry.recordedAt,
      invoiceId: entry.invoiceId,
      billedAt: entry.billedAt,
      createdAt: entry.createdAt,
    };
  }
}
