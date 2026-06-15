import {
  ClientUsersRepository,
  ensureClientAccess,
  getUserFromRequest,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  TicketAutomationResponseDto,
  TicketAutomationRunResponseDto,
  TicketAutomationRunStepResponseDto,
  UpdateTicketAutomationDto,
} from '../dto/ticket-automation';
import { TicketActivityEntity } from '../entities/ticket-activity.entity';
import { TicketAutomationLeaseEntity } from '../entities/ticket-automation-lease.entity';
import { TicketAutomationRunStepEntity } from '../entities/ticket-automation-run-step.entity';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import {
  TicketAutomationCancellationReason,
  TicketAutomationLeaseStatus,
  TicketAutomationRunStatus,
} from '../entities/ticket-automation.enums';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketActionType, TicketActorType, TicketStatus } from '../entities/ticket.enums';
import { ClientsRepository } from '../repositories/clients.repository';
import {
  DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY,
  type TicketAutomationBranchStrategy,
} from '../utils/ticket-automation-branch.constants';
import { ticketActivityEntityToDto } from '../utils/ticket-board-realtime-mappers';
import { parseAndValidateVerifierProfile } from '../utils/verifier-profile.validation';

import { TicketAutomationChatSyncService } from './ticket-automation-chat-sync.service';
import { TICKETS_BOARD_EVENTS } from './ticket-board-realtime.constants';
import { TicketBoardRealtimeService } from './ticket-board-realtime.service';
import { TicketsService } from './tickets.service';

const APPROVAL_RELEVANT_AUTOMATION_FIELDS = new Set([
  'eligible',
  'allowedAgentIds',
  'includeWorkspaceContext',
  'contextEnvironmentIds',
  'autoEnrichmentEnabled',
  'verifierProfile',
  'requiresApproval',
  'defaultBranchOverride',
  'automationBranchStrategy',
]);

function sortUuidList(ids: string[]): string[] {
  return [...ids].sort();
}

function normalizeDefaultBranch(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const t = value.trim();

  return t === '' ? null : t;
}

export const TICKET_APPROVAL_INVALIDATION_FIELDS = new Set([
  'title',
  'content',
  'priority',
  'status',
  'parentId',
  'clientId',
]);

@Injectable()
export class TicketAutomationService {
  constructor(
    @InjectRepository(TicketAutomationEntity)
    private readonly automationRepo: Repository<TicketAutomationEntity>,
    @InjectRepository(TicketAutomationRunEntity)
    private readonly runRepo: Repository<TicketAutomationRunEntity>,
    @InjectRepository(TicketAutomationLeaseEntity)
    private readonly leaseRepo: Repository<TicketAutomationLeaseEntity>,
    @InjectRepository(TicketAutomationRunStepEntity)
    private readonly stepRepo: Repository<TicketAutomationRunStepEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepo: Repository<TicketEntity>,
    @InjectRepository(TicketActivityEntity)
    private readonly activityRepo: Repository<TicketActivityEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly ticketBoardRealtime: TicketBoardRealtimeService,
    private readonly ticketAutomationChatSync: TicketAutomationChatSyncService,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
  ) {}

  private async assertTicketAccess(ticketId: string, req?: RequestWithUser): Promise<TicketEntity> {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });

    if (!ticket) {
      throw new NotFoundException(`Ticket with ID ${ticketId} not found`);
    }

    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, ticket.clientId, req);

    return ticket;
  }

  private resolveActor(req?: RequestWithUser): { actorType: TicketActorType; actorUserId?: string | null } {
    const info = getUserFromRequest(req || ({} as RequestWithUser));

    if (info.userId) {
      return { actorType: TicketActorType.HUMAN, actorUserId: info.userId };
    }

    return { actorType: TicketActorType.SYSTEM, actorUserId: null };
  }

  async ensureRow(ticketId: string): Promise<TicketAutomationEntity> {
    let row = await this.automationRepo.findOne({ where: { ticketId } });

    if (!row) {
      row = await this.automationRepo.save(
        this.automationRepo.create({
          ticketId,
          eligible: false,
          allowedAgentIds: [],
          includeWorkspaceContext: true,
          contextEnvironmentIds: [],
          autoEnrichmentEnabled: true,
          requiresApproval: false,
          automationBranchStrategy: DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY,
          forceNewAutomationBranchNextRun: false,
        }),
      );
    }

    return row;
  }

  /** In-process consumers (e.g. autonomous orchestrator) for realtime payloads. */
  mapAutomationForBoard(row: TicketAutomationEntity): TicketAutomationResponseDto {
    return this.mapAutomation(row);
  }

  private mapAutomation(row: TicketAutomationEntity): TicketAutomationResponseDto {
    return {
      ticketId: row.ticketId,
      eligible: row.eligible,
      allowedAgentIds: row.allowedAgentIds ?? [],
      includeWorkspaceContext: row.includeWorkspaceContext !== false,
      contextEnvironmentIds: sortUuidList(row.contextEnvironmentIds ?? []),
      autoEnrichmentEnabled: row.autoEnrichmentEnabled !== false,
      verifierProfile: row.verifierProfile ?? null,
      requiresApproval: row.requiresApproval,
      approvedAt: row.approvedAt ?? null,
      approvedByUserId: row.approvedByUserId ?? null,
      approvalBaselineTicketUpdatedAt: row.approvalBaselineTicketUpdatedAt ?? null,
      defaultBranchOverride: row.defaultBranchOverride ?? null,
      automationBranchStrategy: (row.automationBranchStrategy ??
        DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY) as TicketAutomationBranchStrategy,
      forceNewAutomationBranchNextRun: row.forceNewAutomationBranchNextRun === true,
      nextRetryAt: row.nextRetryAt ?? null,
      consecutiveFailureCount: row.consecutiveFailureCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getAutomation(ticketId: string, req?: RequestWithUser): Promise<TicketAutomationResponseDto> {
    await this.assertTicketAccess(ticketId, req);
    const row = await this.ensureRow(ticketId);

    return this.mapAutomation(row);
  }

  async patchAutomation(
    ticketId: string,
    dto: UpdateTicketAutomationDto,
    req?: RequestWithUser,
  ): Promise<TicketAutomationResponseDto> {
    const ticket = await this.assertTicketAccess(ticketId, req);
    const row = await this.ensureRow(ticketId);
    const prevEligible = row.eligible;
    const prevRequiresApproval = row.requiresApproval;
    const prevApprovedAt = row.approvedAt;
    const prevAllowedSorted = sortUuidList(row.allowedAgentIds ?? []);
    const prevIncludeWorkspace = row.includeWorkspaceContext !== false;
    const prevContextEnvSorted = sortUuidList(row.contextEnvironmentIds ?? []);
    const prevAutoEnrichmentEnabled = row.autoEnrichmentEnabled !== false;
    const prevVerifierJson = JSON.stringify(parseAndValidateVerifierProfile(row.verifierProfile ?? { commands: [] }));
    const prevDefaultBranch = normalizeDefaultBranch(row.defaultBranchOverride);
    const prevStrategy: TicketAutomationBranchStrategy =
      row.automationBranchStrategy ?? DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY;
    const prevForce = row.forceNewAutomationBranchNextRun === true;
    const actuallyChanged: string[] = [];

    if (dto.eligible !== undefined && dto.eligible !== prevEligible) {
      row.eligible = dto.eligible;
      actuallyChanged.push('eligible');
    }

    if (dto.requiresApproval !== undefined && dto.requiresApproval !== prevRequiresApproval) {
      row.requiresApproval = dto.requiresApproval;
      actuallyChanged.push('requiresApproval');
    }

    if (dto.allowedAgentIds !== undefined) {
      const nextSorted = sortUuidList(dto.allowedAgentIds);

      if (JSON.stringify(nextSorted) !== JSON.stringify(prevAllowedSorted)) {
        row.allowedAgentIds = dto.allowedAgentIds;
        actuallyChanged.push('allowedAgentIds');
      }
    }

    if (dto.includeWorkspaceContext !== undefined && dto.includeWorkspaceContext !== prevIncludeWorkspace) {
      row.includeWorkspaceContext = dto.includeWorkspaceContext;
      actuallyChanged.push('includeWorkspaceContext');
    }

    if (dto.contextEnvironmentIds !== undefined) {
      const nextSorted = sortUuidList(dto.contextEnvironmentIds);

      if (JSON.stringify(nextSorted) !== JSON.stringify(prevContextEnvSorted)) {
        row.contextEnvironmentIds = nextSorted;
        actuallyChanged.push('contextEnvironmentIds');
      }
    }

    if (dto.autoEnrichmentEnabled !== undefined && dto.autoEnrichmentEnabled !== prevAutoEnrichmentEnabled) {
      row.autoEnrichmentEnabled = dto.autoEnrichmentEnabled;
      actuallyChanged.push('autoEnrichmentEnabled');
    }

    if (dto.verifierProfile !== undefined) {
      const parsed = parseAndValidateVerifierProfile(dto.verifierProfile);
      const nextJson = JSON.stringify(parsed);

      if (nextJson !== prevVerifierJson) {
        row.verifierProfile = parsed;
        actuallyChanged.push('verifierProfile');
      }
    }

    if (dto.defaultBranchOverride !== undefined) {
      const nextBranch = normalizeDefaultBranch(dto.defaultBranchOverride);

      if (nextBranch !== prevDefaultBranch) {
        row.defaultBranchOverride = nextBranch;
        actuallyChanged.push('defaultBranchOverride');
      }
    }

    if (dto.automationBranchStrategy !== undefined && dto.automationBranchStrategy !== prevStrategy) {
      row.automationBranchStrategy = dto.automationBranchStrategy;
      actuallyChanged.push('automationBranchStrategy');
    }

    if (dto.forceNewAutomationBranchNextRun !== undefined && dto.forceNewAutomationBranchNextRun !== prevForce) {
      row.forceNewAutomationBranchNextRun = dto.forceNewAutomationBranchNextRun;
      actuallyChanged.push('forceNewAutomationBranchNextRun');
    }

    if (actuallyChanged.length === 0) {
      return this.mapAutomation(row);
    }

    const shouldInvalidateState = actuallyChanged.some((k) => APPROVAL_RELEVANT_AUTOMATION_FIELDS.has(k));

    if (shouldInvalidateState) {
      row.approvedAt = null;
      row.approvedByUserId = null;
      row.approvalBaselineTicketUpdatedAt = null;
    }

    const saved = await this.automationRepo.save(row);
    const hadMeaningfulApproval = prevRequiresApproval === true && prevApprovedAt != null;
    const onlyDisabledApprovalRequirement =
      actuallyChanged.length === 1 && actuallyChanged[0] === 'requiresApproval' && saved.requiresApproval === false;
    const shouldLogApprovalInvalidated =
      hadMeaningfulApproval && shouldInvalidateState && !onlyDisabledApprovalRequirement;

    if (actuallyChanged.includes('eligible')) {
      await this.appendActivity(
        ticketId,
        TicketActionType.AUTOMATION_ELIGIBILITY_CHANGED,
        { eligible: saved.eligible },
        req,
      );
    }

    if (actuallyChanged.includes('requiresApproval')) {
      await this.appendActivity(
        ticketId,
        TicketActionType.AUTOMATION_APPROVAL_REQUIREMENT_CHANGED,
        { requiresApproval: saved.requiresApproval },
        req,
      );
    }

    const settingsDetailFields = actuallyChanged.filter(
      (k) =>
        k === 'allowedAgentIds' ||
        k === 'includeWorkspaceContext' ||
        k === 'contextEnvironmentIds' ||
        k === 'autoEnrichmentEnabled' ||
        k === 'verifierProfile' ||
        k === 'defaultBranchOverride' ||
        k === 'automationBranchStrategy' ||
        k === 'forceNewAutomationBranchNextRun',
    );

    if (settingsDetailFields.length > 0) {
      await this.appendActivity(
        ticketId,
        TicketActionType.AUTOMATION_SETTINGS_UPDATED,
        { fields: settingsDetailFields },
        req,
      );
    }

    if (shouldLogApprovalInvalidated) {
      await this.appendActivity(
        ticketId,
        TicketActionType.AUTOMATION_APPROVAL_INVALIDATED,
        {
          reason: 'automation_settings_changed',
          fields: actuallyChanged,
        },
        req,
      );
    }

    await this.cancelRunningIfApprovalLost(ticketId, req, shouldLogApprovalInvalidated);

    const automationDto = this.mapAutomation(saved);

    this.ticketBoardRealtime.emitToClient(ticket.clientId, TICKETS_BOARD_EVENTS.ticketAutomationUpsert, automationDto);

    return automationDto;
  }

  private async appendActivity(
    ticketId: string,
    action: TicketActionType,
    payload: Record<string, unknown>,
    req?: RequestWithUser,
  ) {
    const actor = this.resolveActor(req);
    const row = await this.activityRepo.save(
      this.activityRepo.create({
        ticketId,
        actorType: actor.actorType,
        actorUserId: actor.actorUserId ?? null,
        actionType: action,
        payload,
      }),
    );
    const t = await this.ticketRepo.findOne({ where: { id: ticketId }, select: ['clientId'] });

    if (t) {
      this.ticketBoardRealtime.emitToClient(
        t.clientId,
        TICKETS_BOARD_EVENTS.ticketActivityCreated,
        ticketActivityEntityToDto(row),
      );
    }
  }

  /**
   * When ticket fields change, clear automation approval if it was granted.
   */
  async invalidateAfterTicketFieldChanges(
    ticketId: string,
    changedKeys: string[],
    req?: RequestWithUser,
  ): Promise<void> {
    if (!changedKeys.some((k) => TICKET_APPROVAL_INVALIDATION_FIELDS.has(k))) {
      return;
    }

    const row = await this.automationRepo.findOne({ where: { ticketId } });

    if (!row?.approvedAt) {
      return;
    }

    row.approvedAt = null;
    row.approvedByUserId = null;
    row.approvalBaselineTicketUpdatedAt = null;
    await this.automationRepo.save(row);
    await this.appendActivity(
      ticketId,
      TicketActionType.AUTOMATION_APPROVAL_INVALIDATED,
      {
        reason: 'ticket_updated',
        fields: changedKeys.filter((k) => TICKET_APPROVAL_INVALIDATION_FIELDS.has(k)),
      },
      req,
    );
    await this.cancelRunningIfApprovalLost(ticketId, req, true);
    const refreshed = await this.automationRepo.findOne({ where: { ticketId } });

    if (refreshed) {
      const t = await this.ticketRepo.findOne({ where: { id: ticketId }, select: ['clientId'] });

      if (t) {
        this.ticketBoardRealtime.emitToClient(
          t.clientId,
          TICKETS_BOARD_EVENTS.ticketAutomationUpsert,
          this.mapAutomation(refreshed),
        );
      }
    }
  }

  private async cancelRunningIfApprovalLost(
    ticketId: string,
    req: RequestWithUser | undefined,
    didInvalidate: boolean,
  ): Promise<void> {
    if (!didInvalidate) {
      return;
    }

    const running = await this.runRepo.find({
      where: { ticketId, status: TicketAutomationRunStatus.RUNNING },
    });

    for (const r of running) {
      await this.cancelRun(ticketId, r.id, req, TicketAutomationCancellationReason.APPROVAL_INVALIDATED);
    }
  }

  async approve(ticketId: string, req?: RequestWithUser): Promise<TicketAutomationResponseDto> {
    const ticket = await this.assertTicketAccess(ticketId, req);
    const info = getUserFromRequest(req || ({} as RequestWithUser));

    if (!info.userId) {
      throw new ForbiddenException('Only interactive users can approve automation');
    }

    const row = await this.ensureRow(ticketId);

    if (!row.requiresApproval) {
      throw new BadRequestException('This ticket does not require approval');
    }

    await this.automationRepo.manager.query(
      `
      UPDATE ticket_automation ta
      SET
        approved_at = NOW(),
        approved_by_user_id = $2,
        approval_baseline_ticket_updated_at = t.updated_at
      FROM tickets t
      WHERE ta.ticket_id = $1 AND t.id = $1
    `,
      [ticketId, info.userId],
    );
    const saved = await this.automationRepo.findOne({ where: { ticketId } });

    if (!saved) {
      throw new NotFoundException('Automation settings not found');
    }

    await this.appendActivity(ticketId, TicketActionType.AUTOMATION_APPROVED, { approvedByUserId: info.userId }, req);
    const dto = this.mapAutomation(saved);

    this.ticketBoardRealtime.emitToClient(ticket.clientId, TICKETS_BOARD_EVENTS.ticketAutomationUpsert, dto);

    return dto;
  }

  async unapprove(ticketId: string, req?: RequestWithUser): Promise<TicketAutomationResponseDto> {
    const ticket = await this.assertTicketAccess(ticketId, req);
    const info = getUserFromRequest(req || ({} as RequestWithUser));

    if (!info.userId) {
      throw new ForbiddenException('Only interactive users can unapprove automation');
    }

    const row = await this.ensureRow(ticketId);

    if (!row.requiresApproval) {
      throw new BadRequestException('This ticket does not require approval');
    }

    if (!row.approvedAt) {
      return this.mapAutomation(row);
    }

    row.approvedAt = null;
    row.approvedByUserId = null;
    row.approvalBaselineTicketUpdatedAt = null;
    const saved = await this.automationRepo.save(row);

    await this.appendActivity(
      ticketId,
      TicketActionType.AUTOMATION_UNAPPROVED,
      { unapprovedByUserId: info.userId },
      req,
    );
    await this.cancelRunningIfApprovalLost(ticketId, req, true);
    const dto = this.mapAutomation(saved);

    this.ticketBoardRealtime.emitToClient(ticket.clientId, TICKETS_BOARD_EVENTS.ticketAutomationUpsert, dto);

    return dto;
  }

  async listRuns(ticketId: string, req?: RequestWithUser): Promise<TicketAutomationRunResponseDto[]> {
    await this.assertTicketAccess(ticketId, req);
    const rows = await this.runRepo.find({
      where: { ticketId },
      order: { startedAt: 'DESC' },
    });

    return rows.map((r) => this.mapRun(r));
  }

  async getRun(ticketId: string, runId: string, req?: RequestWithUser): Promise<TicketAutomationRunResponseDto> {
    await this.assertTicketAccess(ticketId, req);
    const run = await this.runRepo.findOne({ where: { id: runId, ticketId } });

    if (!run) {
      throw new NotFoundException('Run not found');
    }

    const steps = await this.stepRepo.find({
      where: { runId },
      order: { stepIndex: 'ASC' },
    });
    const dto = this.mapRun(run);

    dto.steps = steps.map((s) => this.mapStep(s));

    return dto;
  }

  async cancelRun(
    ticketId: string,
    runId: string,
    req?: RequestWithUser,
    reason: TicketAutomationCancellationReason = TicketAutomationCancellationReason.USER_REQUEST,
  ): Promise<TicketAutomationRunResponseDto> {
    const ticket = await this.assertTicketAccess(ticketId, req);
    const info = getUserFromRequest(req || ({} as RequestWithUser));
    const run = await this.runRepo.findOne({ where: { id: runId, ticketId } });

    if (!run) {
      throw new NotFoundException('Run not found');
    }

    if (run.status !== TicketAutomationRunStatus.PENDING && run.status !== TicketAutomationRunStatus.RUNNING) {
      return this.mapRun(run);
    }

    if (reason === TicketAutomationCancellationReason.USER_REQUEST && !info.userId) {
      throw new ForbiddenException('User context required to cancel');
    }

    run.status = TicketAutomationRunStatus.CANCELLED;
    run.finishedAt = new Date();
    run.cancellationReason = reason;
    run.cancelRequestedAt = new Date();
    run.cancelledByUserId = info.userId ?? null;
    await this.runRepo.save(run);

    const lease = await this.leaseRepo.findOne({ where: { ticketId } });

    if (lease && lease.status === TicketAutomationLeaseStatus.ACTIVE) {
      lease.status = TicketAutomationLeaseStatus.RELEASED;
      await this.leaseRepo.save(lease);
    }

    if (run.ticketStatusBefore) {
      ticket.status = run.ticketStatusBefore as TicketStatus;
      await this.ticketRepo.save(ticket);
      const automationRow = await this.automationRepo.findOne({ where: { ticketId } });

      if (automationRow?.approvedAt) {
        const u = await this.ticketRepo.findOne({ where: { id: ticketId }, select: ['updatedAt'] });

        if (u) {
          await this.automationRepo.update({ ticketId }, { approvalBaselineTicketUpdatedAt: u.updatedAt });
        }
      }
    }

    await this.appendActivity(ticketId, TicketActionType.AUTOMATION_CANCELLED, { runId, reason }, req);

    this.ticketBoardRealtime.emitToClient(
      ticket.clientId,
      TICKETS_BOARD_EVENTS.ticketAutomationRunUpsert,
      this.mapRun(run),
    );
    this.ticketAutomationChatSync.emitLiveRunUpdateFromEntity(run);
    const autoFresh = await this.automationRepo.findOne({ where: { ticketId } });

    if (autoFresh) {
      this.ticketBoardRealtime.emitToClient(
        ticket.clientId,
        TICKETS_BOARD_EVENTS.ticketAutomationUpsert,
        this.mapAutomation(autoFresh),
      );
    }

    await this.ticketsService.emitBoardTicketSnapshotInternal(ticketId);

    return this.mapRun(run);
  }

  private mapRun(r: TicketAutomationRunEntity): TicketAutomationRunResponseDto {
    return {
      id: r.id,
      ticketId: r.ticketId,
      clientId: r.clientId,
      agentId: r.agentId,
      status: r.status,
      phase: r.phase,
      ticketStatusBefore: r.ticketStatusBefore,
      branchName: r.branchName ?? null,
      baseBranch: r.baseBranch ?? null,
      baseSha: r.baseSha ?? null,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      updatedAt: r.updatedAt,
      iterationCount: r.iterationCount,
      completionMarkerSeen: r.completionMarkerSeen,
      verificationPassed: r.verificationPassed ?? null,
      failureCode: r.failureCode ?? null,
      summary: r.summary ?? null,
      cancelRequestedAt: r.cancelRequestedAt ?? null,
      cancelledByUserId: r.cancelledByUserId ?? null,
      cancellationReason: r.cancellationReason ?? null,
    };
  }

  private mapStep(s: TicketAutomationRunStepEntity): TicketAutomationRunStepResponseDto {
    return {
      id: s.id,
      stepIndex: s.stepIndex,
      phase: s.phase,
      kind: s.kind,
      payload: s.payload ?? null,
      excerpt: s.excerpt ?? null,
      createdAt: s.createdAt,
    };
  }
}
