import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import type { UserInfoFromRequest } from '../../utils/billing-access.utils';
import type {
  CreateProjectMilestoneDto,
  ProjectMilestoneResponseDto,
  UpdateProjectMilestoneDto,
} from '../dto/project-milestone.dto';
import type { ProjectMilestoneEntity } from '../entities/project-milestone.entity';
import { ProjectMilestonesRepository } from '../repositories/project-milestones.repository';
import { ProjectTicketsRepository } from '../repositories/project-tickets.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ensureProjectAdmin, ensureProjectReadable } from '../utils/project-access.utils';
import { ProjectBoardRealtimeService } from './project-board-realtime.service';
import { PROJECTS_BOARD_EVENTS } from './project-board-realtime.constants';
import { ProjectBoardSummaryService } from './project-board-summary.service';
import { computeMilestoneProgressPercent } from '../utils/project-milestone-progress.utils';

@Injectable()
export class ProjectMilestonesService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly milestonesRepository: ProjectMilestonesRepository,
    private readonly ticketsRepository: ProjectTicketsRepository,
    private readonly projectBoardRealtime: ProjectBoardRealtimeService,
    private readonly projectBoardSummary: ProjectBoardSummaryService,
  ) {}

  async list(projectId: string, userInfo: UserInfoFromRequest): Promise<ProjectMilestoneResponseDto[]> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);

    ensureProjectReadable(userInfo, project);

    const milestones = await this.milestonesRepository.findAllByProject(projectId);

    return await Promise.all(milestones.map((m) => this.mapMilestone(m)));
  }

  async create(
    projectId: string,
    dto: CreateProjectMilestoneDto,
    userInfo: UserInfoFromRequest,
  ): Promise<ProjectMilestoneResponseDto> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);

    ensureProjectAdmin(userInfo);
    ensureProjectReadable(userInfo, project);

    const milestone = await this.milestonesRepository.create({
      projectId,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
      sortOrder: dto.sortOrder ?? 0,
    });

    const mapped = await this.mapMilestone(milestone);

    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.milestoneUpsert, mapped);
    await this.projectBoardSummary.emitSummaryChanged(project);

    return mapped;
  }

  async update(
    projectId: string,
    milestoneId: string,
    dto: UpdateProjectMilestoneDto,
    userInfo: UserInfoFromRequest,
  ): Promise<ProjectMilestoneResponseDto> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const milestone = await this.milestonesRepository.findByIdOrThrow(milestoneId);

    if (milestone.projectId !== projectId) {
      throw new ForbiddenException('Milestone does not belong to project');
    }

    ensureProjectAdmin(userInfo);
    ensureProjectReadable(userInfo, project);

    if (milestone.lockedAt) {
      throw new BadRequestException('Cannot update locked milestone');
    }

    const updated = await this.milestonesRepository.update(milestoneId, {
      name: dto.name?.trim(),
      description: dto.description === undefined ? undefined : (dto.description?.trim() ?? null),
      targetDate: dto.targetDate === undefined ? undefined : dto.targetDate ? new Date(dto.targetDate) : null,
      sortOrder: dto.sortOrder,
    });

    const mapped = await this.mapMilestone(updated);

    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.milestoneUpsert, mapped);
    await this.projectBoardSummary.emitSummaryChanged(project);

    return mapped;
  }

  async lock(
    projectId: string,
    milestoneId: string,
    userInfo: UserInfoFromRequest,
  ): Promise<ProjectMilestoneResponseDto> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const milestone = await this.milestonesRepository.findByIdOrThrow(milestoneId);

    if (milestone.projectId !== projectId) {
      throw new ForbiddenException('Milestone does not belong to project');
    }

    ensureProjectAdmin(userInfo);
    ensureProjectReadable(userInfo, project);

    const updated = await this.milestonesRepository.update(milestoneId, {
      lockedAt: milestone.lockedAt ?? new Date(),
    });

    const mapped = await this.mapMilestone(updated);

    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.milestoneUpsert, mapped);
    await this.projectBoardSummary.emitSummaryChanged(project);

    return mapped;
  }

  async delete(projectId: string, milestoneId: string, userInfo: UserInfoFromRequest): Promise<void> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const milestone = await this.milestonesRepository.findByIdOrThrow(milestoneId);

    if (milestone.projectId !== projectId) {
      throw new ForbiddenException('Milestone does not belong to project');
    }

    ensureProjectAdmin(userInfo);
    ensureProjectReadable(userInfo, project);

    if (milestone.lockedAt) {
      throw new BadRequestException('Cannot delete locked milestone');
    }

    await this.milestonesRepository.delete(milestoneId);

    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.milestoneRemoved, {
      id: milestoneId,
      projectId,
    });
    await this.projectBoardSummary.emitSummaryChanged(project);
  }

  private async mapMilestone(milestone: ProjectMilestoneEntity): Promise<ProjectMilestoneResponseDto> {
    const counts = await this.ticketsRepository.countByMilestone(milestone.id);
    const progressPercent = computeMilestoneProgressPercent(counts.open, counts.done);

    return {
      id: milestone.id,
      projectId: milestone.projectId,
      name: milestone.name,
      description: milestone.description,
      targetDate: milestone.targetDate,
      sortOrder: milestone.sortOrder,
      lockedAt: milestone.lockedAt,
      progressPercent,
      openTicketCount: counts.open,
      doneTicketCount: counts.done,
      createdAt: milestone.createdAt,
      updatedAt: milestone.updatedAt,
    };
  }
}
