import { Injectable } from '@nestjs/common';

import type {
  PaginatedProjectsResponseDto,
  ProjectListItemDto,
  ProjectResponseDto,
  ProjectSummaryResponseDto,
} from '../dto/project.dto';
import type { ProjectEntity } from '../entities/project.entity';
import { ProjectTicketStatus } from '../entities/project.enums';
import { ProjectMilestonesRepository } from '../repositories/project-milestones.repository';
import { ProjectTicketsRepository } from '../repositories/project-tickets.repository';
import { ProjectTimeEntriesRepository } from '../repositories/project-time-entries.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import type { UserInfoFromRequest } from '../../utils/billing-access.utils';
import { ensureProjectReadable } from '../utils/project-access.utils';
import { computeMilestoneProgressPercent, isMilestoneComplete } from '../utils/project-milestone-progress.utils';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly milestonesRepository: ProjectMilestonesRepository,
    private readonly ticketsRepository: ProjectTicketsRepository,
    private readonly timeEntriesRepository: ProjectTimeEntriesRepository,
  ) {}

  async listForUser(userId: string, limit: number, offset: number): Promise<PaginatedProjectsResponseDto> {
    const { items, total } = await this.projectsRepository.findAllByUser(userId, limit, offset);

    return {
      items: await Promise.all(items.map((project) => this.mapListItem(project))),
      total,
      limit,
      offset,
    };
  }

  async getByIdForUser(userInfo: UserInfoFromRequest, projectId: string): Promise<ProjectResponseDto> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);

    ensureProjectReadable(userInfo, project);

    return this.mapResponse(project);
  }

  async getSummary(userInfo: UserInfoFromRequest, projectId: string): Promise<ProjectSummaryResponseDto> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);

    ensureProjectReadable(userInfo, project);

    return await this.buildSummary(project);
  }

  async buildSummary(project: ProjectEntity): Promise<ProjectSummaryResponseDto> {
    const [totalTrackedMinutes, unbilledMinutes, milestones, tickets] = await Promise.all([
      this.timeEntriesRepository.sumDurationMinutes(project.id),
      this.timeEntriesRepository.sumDurationMinutes(project.id, false),
      this.milestonesRepository.findAllByProject(project.id),
      this.ticketsRepository.findAllByProject(project.id),
    ]);

    const billedMinutes = totalTrackedMinutes - unbilledMinutes;
    const hourlyRate = Number(project.hourlyRateNet);
    const openBillableAmountNet = (unbilledMinutes / 60) * hourlyRate;
    const billedAmountNet = (billedMinutes / 60) * hourlyRate;

    let openTicketCount = 0;
    let doneTicketCount = 0;

    for (const ticket of tickets) {
      if (ticket.status === ProjectTicketStatus.DONE || ticket.status === ProjectTicketStatus.CLOSED) {
        doneTicketCount += 1;
      } else {
        openTicketCount += 1;
      }
    }

    let openMilestoneCount = 0;

    await Promise.all(
      milestones.map(async (milestone) => {
        const counts = await this.ticketsRepository.countByMilestone(milestone.id);
        const progressPercent = computeMilestoneProgressPercent(counts.open, counts.done);

        if (!isMilestoneComplete(progressPercent)) {
          openMilestoneCount += 1;
        }
      }),
    );

    return {
      projectId: project.id,
      totalTrackedMinutes,
      unbilledMinutes,
      openBillableAmountNet,
      billedAmountNet,
      openTicketCount,
      doneTicketCount,
      milestoneCount: milestones.length,
      openMilestoneCount,
    };
  }

  mapResponse(project: ProjectEntity): ProjectResponseDto {
    return {
      id: project.id,
      userId: project.userId,
      name: project.name,
      description: project.description,
      status: project.status,
      hourlyRateNet: Number(project.hourlyRateNet),
      targetHours: project.targetHours != null ? Number(project.targetHours) : null,
      currency: project.currency,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  async mapListItem(project: ProjectEntity): Promise<ProjectListItemDto> {
    const unbilledMinutes = await this.timeEntriesRepository.sumDurationMinutes(project.id, false);
    const openBillableAmountNet = (unbilledMinutes / 60) * Number(project.hourlyRateNet);

    return {
      ...this.mapResponse(project),
      unbilledMinutes,
      openBillableAmountNet,
    };
  }
}
