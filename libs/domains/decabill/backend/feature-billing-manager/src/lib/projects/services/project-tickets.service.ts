import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import type { UserInfoFromRequest } from '../../utils/billing-access.utils';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';
import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import type {
  CreateProjectTicketCommentDto,
  CreateProjectTicketDto,
  ProjectTicketActivityResponseDto,
  ProjectTicketCommentResponseDto,
  ProjectTicketResponseDto,
  UpdateProjectTicketDto,
} from '../dto/project-ticket.dto';
import type { ProjectTicketEntity } from '../entities/project-ticket.entity';
import {
  ProjectTicketActionType,
  ProjectTicketActorType,
  ProjectTicketPriority,
  ProjectTicketStatus,
} from '../entities/project.enums';
import { ProjectMilestonesRepository } from '../repositories/project-milestones.repository';
import { ProjectTicketActivitiesRepository } from '../repositories/project-ticket-activities.repository';
import { ProjectTicketCommentsRepository } from '../repositories/project-ticket-comments.repository';
import { ProjectTicketsRepository } from '../repositories/project-tickets.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import {
  ensureProjectAdmin,
  ensureProjectComment,
  ensureProjectReadable,
  ensureTicketUnlocked,
} from '../utils/project-access.utils';
import { deriveProjectTicketLongSha, shortShaFromLong } from '../utils/project-ticket-sha.utils';
import {
  buildDescendantCheckboxTaskTotalsByTicketId,
  countMarkdownCheckboxTasks,
} from '../utils/ticket-content-checkbox-tasks.utils';
import { ProjectBoardRealtimeService } from './project-board-realtime.service';
import { PROJECTS_BOARD_EVENTS } from './project-board-realtime.constants';
import { ProjectBoardSummaryService } from './project-board-summary.service';

@Injectable()
export class ProjectTicketsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly ticketsRepository: ProjectTicketsRepository,
    private readonly milestonesRepository: ProjectMilestonesRepository,
    private readonly commentsRepository: ProjectTicketCommentsRepository,
    private readonly activitiesRepository: ProjectTicketActivitiesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly projectBoardRealtime: ProjectBoardRealtimeService,
    private readonly projectBoardSummary: ProjectBoardSummaryService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
  ) {}

  async listTickets(
    projectId: string,
    userInfo: UserInfoFromRequest,
    filters?: { status?: ProjectTicketStatus; parentId?: string | null },
  ): Promise<ProjectTicketResponseDto[]> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);

    ensureProjectReadable(userInfo, project);

    const rows = await this.ticketsRepository.findAllByProject(projectId, filters);

    if (rows.length === 0) {
      return [];
    }

    const all = await this.ticketsRepository.findAllByProject(projectId);
    const descMap = buildDescendantCheckboxTaskTotalsByTicketId(all);

    return Promise.all(rows.map((row) => this.mapTicket(row, descMap)));
  }

  async findOne(
    projectId: string,
    ticketId: string,
    includeDescendants: boolean,
    userInfo: UserInfoFromRequest,
  ): Promise<ProjectTicketResponseDto> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const ticket = await this.ticketsRepository.findByIdOrThrow(ticketId);

    if (ticket.projectId !== projectId) {
      throw new ForbiddenException('Ticket does not belong to project');
    }

    ensureProjectReadable(userInfo, project);

    const all = await this.ticketsRepository.findAllByProject(projectId);
    const descMap = buildDescendantCheckboxTaskTotalsByTicketId(all);
    const dto = await this.mapTicket(ticket, descMap);

    if (includeDescendants) {
      dto.children = await this.buildChildTicketDtos(ticket.id, all, descMap);
    }

    return dto;
  }

  async create(
    projectId: string,
    dto: CreateProjectTicketDto,
    req: RequestWithUser,
  ): Promise<ProjectTicketResponseDto> {
    const userInfo = getUserFromRequest(req);
    const project = await this.projectsRepository.findByIdOrThrow(projectId);

    ensureProjectAdmin(userInfo);
    ensureProjectReadable(userInfo, project);

    const parentId = dto.parentId ?? null;

    if (parentId) {
      const parent = await this.ticketsRepository.findByIdOrThrow(parentId);

      if (parent.projectId !== projectId) {
        throw new BadRequestException('Parent ticket must belong to the same project');
      }
    }

    if (dto.milestoneId) {
      const milestone = await this.milestonesRepository.findByIdOrThrow(dto.milestoneId);

      if (milestone.projectId !== projectId) {
        throw new BadRequestException('Milestone must belong to the same project');
      }
    }

    const ticket = await this.ticketsRepository.create({
      projectId,
      parentId,
      milestoneId: dto.milestoneId ?? null,
      title: dto.title.trim(),
      content: dto.content ?? null,
      priority: dto.priority ?? ProjectTicketPriority.MEDIUM,
      status: dto.status ?? ProjectTicketStatus.DRAFT,
      createdByUserId: userInfo.userId ?? null,
      locked: false,
    });

    const longSha = deriveProjectTicketLongSha(ticket.id);
    const saved = await this.ticketsRepository.update(ticket.id, { longSha });

    await this.activitiesRepository.create({
      ticketId: saved.id,
      actorType: ProjectTicketActorType.HUMAN,
      actorUserId: userInfo.userId ?? null,
      actionType: ProjectTicketActionType.CREATED,
      payload: { title: saved.title, projectId, parentId },
    });

    const mapped = await this.findOne(projectId, saved.id, false, userInfo);

    this.billingNotificationPublisher.publishTicket('ticket.created', project.userId, mapped);
    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.ticketUpsert, mapped);
    await this.projectBoardSummary.emitSummaryChanged(project);

    return mapped;
  }

  async update(
    projectId: string,
    ticketId: string,
    dto: UpdateProjectTicketDto,
    req: RequestWithUser,
  ): Promise<ProjectTicketResponseDto> {
    const userInfo = getUserFromRequest(req);
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const ticket = await this.ticketsRepository.findByIdOrThrow(ticketId);

    if (ticket.projectId !== projectId) {
      throw new ForbiddenException('Ticket does not belong to project');
    }

    ensureProjectAdmin(userInfo);
    ensureProjectReadable(userInfo, project);

    if (ticket.locked) {
      throw new BadRequestException('Cannot update locked ticket');
    }

    if (dto.locked === true) {
      await this.ticketsRepository.update(ticketId, { locked: true });

      await this.activitiesRepository.create({
        ticketId,
        actorType: ProjectTicketActorType.HUMAN,
        actorUserId: userInfo.userId ?? null,
        actionType: ProjectTicketActionType.LOCKED,
        payload: {},
      });

      const mapped = await this.findOne(projectId, ticketId, false, userInfo);

      this.billingNotificationPublisher.publishTicket('ticket.updated', project.userId, mapped);
      this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.ticketUpsert, mapped);
      await this.projectBoardSummary.emitSummaryChanged(project);

      return mapped;
    }

    if (dto.parentId !== undefined && dto.parentId) {
      const parent = await this.ticketsRepository.findByIdOrThrow(dto.parentId);

      if (parent.projectId !== projectId) {
        throw new BadRequestException('Parent ticket must belong to the same project');
      }
    }

    if (dto.milestoneId) {
      const ms = await this.milestonesRepository.findByIdOrThrow(dto.milestoneId);

      if (ms.projectId !== projectId) {
        throw new BadRequestException('Milestone must belong to the same project');
      }
    }

    await this.ticketsRepository.update(ticketId, {
      parentId: dto.parentId,
      milestoneId: dto.milestoneId,
      title: dto.title?.trim(),
      content: dto.content,
      priority: dto.priority,
      status: dto.status,
      locked: dto.locked,
    });

    await this.recordFieldActivity(ticket, dto, userInfo);

    const mapped = await this.findOne(projectId, ticketId, false, userInfo);

    this.billingNotificationPublisher.publishTicket('ticket.updated', project.userId, mapped);
    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.ticketUpsert, mapped);
    await this.projectBoardSummary.emitSummaryChanged(project);

    return mapped;
  }

  async delete(projectId: string, ticketId: string, req: RequestWithUser): Promise<void> {
    const userInfo = getUserFromRequest(req);
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const ticket = await this.ticketsRepository.findByIdOrThrow(ticketId);

    if (ticket.projectId !== projectId) {
      throw new ForbiddenException('Ticket does not belong to project');
    }

    ensureProjectAdmin(userInfo);
    ensureProjectReadable(userInfo, project);

    if (ticket.locked) {
      throw new BadRequestException('Cannot delete locked ticket');
    }

    await this.activitiesRepository.create({
      ticketId,
      actorType: ProjectTicketActorType.HUMAN,
      actorUserId: userInfo.userId ?? null,
      actionType: ProjectTicketActionType.DELETED,
      payload: { title: ticket.title },
    });

    await this.ticketsRepository.delete(ticketId);

    this.billingNotificationPublisher.publishTicket('ticket.deleted', project.userId, ticket);
    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.ticketRemoved, {
      id: ticketId,
      projectId,
    });
    await this.projectBoardSummary.emitSummaryChanged(project);
  }

  async listComments(
    projectId: string,
    ticketId: string,
    userInfo: UserInfoFromRequest,
  ): Promise<ProjectTicketCommentResponseDto[]> {
    await this.assertTicketReadable(projectId, ticketId, userInfo);

    const comments = await this.commentsRepository.findAllByTicket(ticketId);

    return Promise.all(comments.map((c) => this.mapComment(c)));
  }

  async addComment(
    projectId: string,
    ticketId: string,
    dto: CreateProjectTicketCommentDto,
    req: RequestWithUser,
  ): Promise<ProjectTicketCommentResponseDto> {
    const userInfo = getUserFromRequest(req);
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const ticket = await this.ticketsRepository.findByIdOrThrow(ticketId);

    if (ticket.projectId !== projectId) {
      throw new ForbiddenException('Ticket does not belong to project');
    }

    ensureProjectComment(userInfo, project);
    ensureTicketUnlocked(ticket);

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const comment = await this.commentsRepository.create({
      ticketId,
      userId: userInfo.userId,
      body: dto.body.trim(),
    });

    await this.activitiesRepository.create({
      ticketId,
      actorType: ProjectTicketActorType.HUMAN,
      actorUserId: userInfo.userId,
      actionType: ProjectTicketActionType.COMMENT_ADDED,
      payload: { commentId: comment.id },
    });

    const mapped = await this.mapComment(comment);

    this.billingNotificationPublisher.publishTicketComment(project.userId, projectId, mapped);
    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.ticketCommentCreated, mapped);

    const activityRows = await this.activitiesRepository.findAllByTicket(ticketId, 1, 0);

    if (activityRows[0]) {
      this.projectBoardRealtime.emitToProject(
        projectId,
        PROJECTS_BOARD_EVENTS.ticketActivityCreated,
        this.mapActivity(activityRows[0]),
      );
    }

    return mapped;
  }

  async listActivity(
    projectId: string,
    ticketId: string,
    limit: number,
    offset: number,
    userInfo: UserInfoFromRequest,
  ): Promise<ProjectTicketActivityResponseDto[]> {
    await this.assertTicketReadable(projectId, ticketId, userInfo);

    const rows = await this.activitiesRepository.findAllByTicket(ticketId, limit, offset);

    return rows.map((r) => this.mapActivity(r));
  }

  private async assertTicketReadable(
    projectId: string,
    ticketId: string,
    userInfo: UserInfoFromRequest,
  ): Promise<ProjectTicketEntity> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const ticket = await this.ticketsRepository.findByIdOrThrow(ticketId);

    if (ticket.projectId !== projectId) {
      throw new ForbiddenException('Ticket does not belong to project');
    }

    ensureProjectReadable(userInfo, project);

    return ticket;
  }

  private async buildChildTicketDtos(
    parentTicketId: string,
    all: ProjectTicketEntity[],
    descMap: Map<string, { open: number; done: number }>,
  ): Promise<ProjectTicketResponseDto[]> {
    const byParent = new Map<string | null, ProjectTicketEntity[]>();

    for (const t of all) {
      const p = t.parentId ?? null;

      if (!byParent.has(p)) {
        byParent.set(p, []);
      }

      byParent.get(p)!.push(t);
    }

    const build = async (parentId: string): Promise<ProjectTicketResponseDto[]> => {
      const kids = byParent.get(parentId) ?? [];
      const out: ProjectTicketResponseDto[] = [];

      for (const k of kids) {
        const d = await this.mapTicket(k, descMap);

        d.children = await build(k.id);
        out.push(d);
      }

      return out;
    };

    return build(parentTicketId);
  }

  private async mapTicket(
    row: ProjectTicketEntity,
    descMap: Map<string, { open: number; done: number }>,
  ): Promise<ProjectTicketResponseDto> {
    const own = countMarkdownCheckboxTasks(row.content);
    const children = descMap.get(row.id) ?? { open: 0, done: 0 };
    const longSha = row.longSha ?? deriveProjectTicketLongSha(row.id);
    let createdByEmail: string | undefined;

    if (row.createdByUserId) {
      const user = await this.usersRepository.findByIdForTenant(row.createdByUserId);

      createdByEmail = user?.email;
    }

    return {
      id: row.id,
      projectId: row.projectId,
      parentId: row.parentId,
      milestoneId: row.milestoneId,
      title: row.title,
      content: row.content,
      status: row.status,
      priority: row.priority,
      shas: {
        short: shortShaFromLong(longSha),
        long: longSha,
      },
      tasks: {
        open: own.open,
        done: own.done,
        children,
      },
      createdByUserId: row.createdByUserId,
      createdByEmail,
      locked: row.locked,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async mapComment(comment: { id: string; ticketId: string; userId: string; body: string; createdAt: Date }) {
    const user = await this.usersRepository.findByIdForTenant(comment.userId);

    return {
      id: comment.id,
      ticketId: comment.ticketId,
      userId: comment.userId,
      userEmail: user?.email,
      body: comment.body,
      createdAt: comment.createdAt,
    };
  }

  private mapActivity(row: {
    id: string;
    ticketId: string;
    occurredAt: Date;
    actorType: string;
    actorUserId?: string | null;
    actionType: string;
    payload: Record<string, unknown>;
  }): ProjectTicketActivityResponseDto {
    return {
      id: row.id,
      ticketId: row.ticketId,
      occurredAt: row.occurredAt,
      actorType: row.actorType,
      actorUserId: row.actorUserId,
      actionType: row.actionType,
      payload: row.payload,
    };
  }

  private async recordFieldActivity(
    before: ProjectTicketEntity,
    dto: UpdateProjectTicketDto,
    userInfo: UserInfoFromRequest,
  ): Promise<void> {
    if (dto.status !== undefined && dto.status !== before.status) {
      await this.activitiesRepository.create({
        ticketId: before.id,
        actorType: ProjectTicketActorType.HUMAN,
        actorUserId: userInfo.userId ?? null,
        actionType: ProjectTicketActionType.STATUS_CHANGED,
        payload: { from: before.status, to: dto.status },
      });
    }

    if (dto.priority !== undefined && dto.priority !== before.priority) {
      await this.activitiesRepository.create({
        ticketId: before.id,
        actorType: ProjectTicketActorType.HUMAN,
        actorUserId: userInfo.userId ?? null,
        actionType: ProjectTicketActionType.PRIORITY_CHANGED,
        payload: { from: before.priority, to: dto.priority },
      });
    }

    if (dto.parentId !== undefined && dto.parentId !== before.parentId) {
      await this.activitiesRepository.create({
        ticketId: before.id,
        actorType: ProjectTicketActorType.HUMAN,
        actorUserId: userInfo.userId ?? null,
        actionType: ProjectTicketActionType.PARENT_CHANGED,
        payload: { from: before.parentId, to: dto.parentId },
      });
    }

    if (dto.milestoneId !== undefined && (dto.milestoneId ?? null) !== (before.milestoneId ?? null)) {
      await this.activitiesRepository.create({
        ticketId: before.id,
        actorType: ProjectTicketActorType.HUMAN,
        actorUserId: userInfo.userId ?? null,
        actionType: ProjectTicketActionType.MILESTONE_CHANGED,
        payload: { from: before.milestoneId ?? null, to: dto.milestoneId ?? null },
      });
    }

    if (
      (dto.title !== undefined && dto.title !== before.title) ||
      (dto.content !== undefined && dto.content !== before.content)
    ) {
      await this.activitiesRepository.create({
        ticketId: before.id,
        actorType: ProjectTicketActorType.HUMAN,
        actorUserId: userInfo.userId ?? null,
        actionType: ProjectTicketActionType.FIELD_UPDATED,
        payload: {},
      });
    }
  }
}
