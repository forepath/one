import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ClientAgentAutonomyEntity } from '../entities/client-agent-autonomy.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { TicketActivityEntity } from '../entities/ticket-activity.entity';
import { TicketAutomationLeaseEntity } from '../entities/ticket-automation-lease.entity';
import { TicketAutomationRunStepEntity } from '../entities/ticket-automation-run-step.entity';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import {
  TicketAutomationFailureCode,
  TicketAutomationLeaseStatus,
  TicketAutomationRunPhase,
  TicketAutomationRunStatus,
} from '../entities/ticket-automation.enums';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketActionType, TicketActorType, TicketStatus } from '../entities/ticket.enums';
import { AGENSTRA_AUTOMATION_COMPLETE } from '../utils/automation-completion.constants';
import { routeAutomationFailure } from '../utils/automation-failure-routing';
import { isUsablePartialPrototype } from '../utils/automation-usable-partial';
import {
  buildAutonomousCommitMessagePrompt,
  buildFallbackAutonomousCommitMessage,
  sanitizeConventionalCommitSubject,
} from '../utils/autonomous-commit-message.utils';
import {
  DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY,
  ephemeralAutomationBranchNameForRun,
  stableAutomationBranchNameForTicket,
  type TicketAutomationBranchStrategy,
} from '../utils/ticket-automation-branch.constants';
import { listContainsBranchName } from '../utils/ticket-automation-branch.utils';
import {
  ticketActivityEntityToDto,
  ticketAutomationRunEntityToDto,
  ticketAutomationRunStepEntityToDto,
} from '../utils/ticket-board-realtime-mappers';
import { buildAutonomousTicketRunPreamble } from '../utils/tickets-prototype-prompt.utils';

import { ClientAgentVcsProxyService } from './client-agent-vcs-proxy.service';
import { RemoteAgentsSessionService } from './remote-agents-session.service';
import { TicketAutomationChatSyncService } from './ticket-automation-chat-sync.service';
import { TicketAutomationService } from './ticket-automation.service';
import { TICKETS_BOARD_EVENTS } from './ticket-board-realtime.constants';
import { TicketBoardRealtimeService } from './ticket-board-realtime.service';
import { TicketsService } from './tickets.service';

interface RunnableCandidate {
  ticket_id: string;
  client_id: string;
  agent_id: string;
}

@Injectable()
export class AutonomousRunOrchestratorService {
  private readonly logger = new Logger(AutonomousRunOrchestratorService.name);
  private readonly runSummaryEmitMinIntervalMs = 1000;
  private readonly lastRunSummaryEmitMs = new Map<string, number>();

  constructor(
    @InjectRepository(TicketEntity)
    private readonly ticketRepo: Repository<TicketEntity>,
    @InjectRepository(TicketAutomationEntity)
    private readonly automationRepo: Repository<TicketAutomationEntity>,
    @InjectRepository(TicketAutomationRunEntity)
    private readonly runRepo: Repository<TicketAutomationRunEntity>,
    @InjectRepository(TicketAutomationLeaseEntity)
    private readonly leaseRepo: Repository<TicketAutomationLeaseEntity>,
    @InjectRepository(TicketAutomationRunStepEntity)
    private readonly stepRepo: Repository<TicketAutomationRunStepEntity>,
    @InjectRepository(TicketActivityEntity)
    private readonly activityRepo: Repository<TicketActivityEntity>,
    @InjectRepository(ClientAgentAutonomyEntity)
    private readonly autonomyRepo: Repository<ClientAgentAutonomyEntity>,
    private readonly remoteChat: RemoteAgentsSessionService,
    private readonly vcsProxy: ClientAgentVcsProxyService,
    private readonly ticketBoardRealtime: TicketBoardRealtimeService,
    private readonly ticketAutomationChatSync: TicketAutomationChatSyncService,
    private readonly ticketsService: TicketsService,
    private readonly ticketAutomationService: TicketAutomationService,
  ) {}

  async processBatch(batchSize: number): Promise<void> {
    const candidates = await this.findCandidates(batchSize);

    for (const candidate of candidates) {
      await this.tryStartRunForCandidate(candidate);
    }
  }

  async findCandidateIds(batchSize: number): Promise<RunnableCandidate[]> {
    return this.findCandidates(batchSize);
  }

  async tryStartRunForCandidate(candidate: RunnableCandidate): Promise<void> {
    try {
      await this.tryStartRun(candidate);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      this.logger.warn(`Orchestrator skip ticket ${candidate.ticket_id}: ${message}`, stack);
    }
  }

  private async findCandidates(limit: number): Promise<RunnableCandidate[]> {
    return await this.ticketRepo.manager.query(
      `
      SELECT t.id AS ticket_id, t.client_id, caa.agent_id
      FROM tickets t
      INNER JOIN ticket_automation ta ON ta.ticket_id = t.id
      INNER JOIN client_agent_autonomy caa ON caa.client_id = t.client_id AND caa.enabled = true
      WHERE ta.eligible = true
        AND t.status IN ('todo', 'in_progress')
        AND (
          COALESCE(jsonb_array_length(COALESCE(ta.allowed_agent_ids, '[]'::jsonb)), 0) = 0
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(ta.allowed_agent_ids) e(e)
            WHERE e.e = caa.agent_id::text
          )
        )
        AND (
          ta.requires_approval = false
          OR (
            ta.approved_at IS NOT NULL
            AND ta.approval_baseline_ticket_updated_at IS NOT NULL
            AND t.updated_at <= ta.approval_baseline_ticket_updated_at
          )
        )
        AND (ta.next_retry_at IS NULL OR ta.next_retry_at <= NOW())
        AND NOT EXISTS (
          SELECT 1 FROM ticket_automation_run r
          WHERE r.ticket_id = t.id AND r.status = 'running'
        )
        AND NOT EXISTS (
          SELECT 1 FROM ticket_automation_lease l
          WHERE l.ticket_id = t.id AND l.status = 'active' AND l.expires_at > NOW()
        )
      ORDER BY t.updated_at ASC
      LIMIT $1
    `,
      [limit],
    );
  }

  private async tryStartRun(c: RunnableCandidate): Promise<void> {
    const ticket = await this.ticketRepo.findOne({ where: { id: c.ticket_id } });
    const automation = await this.automationRepo.findOne({ where: { ticketId: c.ticket_id } });
    const autonomy = await this.autonomyRepo.findOne({
      where: { clientId: c.client_id, agentId: c.agent_id },
    });

    if (!ticket || !automation || !autonomy) {
      return;
    }

    const allowedAgentIds = automation.allowedAgentIds ?? [];

    if (allowedAgentIds.length > 0 && !allowedAgentIds.includes(c.agent_id)) {
      return;
    }

    const run = await this.createRunAndLeaseInTransaction(ticket, c.agent_id, autonomy);

    if (!run) {
      return;
    }

    await this.appendSystemActivity(ticket.id, TicketActionType.AUTOMATION_STARTED, { runId: run.id });
    await this.emitRunSummaryNow(ticket.clientId, run.id);

    try {
      await this.executeRunWorkflow(run, ticket, automation, autonomy, c.agent_id);
    } catch (error: unknown) {
      this.logOrchestratorError(run.id, error);
      await this.failRun(run.id, TicketAutomationFailureCode.AGENT_PROVIDER_ERROR);
    }
  }

  private async createRunAndLeaseInTransaction(
    ticket: TicketEntity,
    agentId: string,
    autonomy: ClientAgentAutonomyEntity,
  ): Promise<TicketAutomationRunEntity | null> {
    return await this.runRepo.manager.transaction(async (em) => {
      const leaseRepo = em.getRepository(TicketAutomationLeaseEntity);
      const existing = await leaseRepo.findOne({
        where: { ticketId: ticket.id, status: TicketAutomationLeaseStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
      });

      if (existing && existing.expiresAt > new Date()) {
        return null;
      }

      const runRepo = em.getRepository(TicketAutomationRunEntity);
      const r = await runRepo.save(
        runRepo.create({
          ticketId: ticket.id,
          clientId: ticket.clientId,
          agentId,
          status: TicketAutomationRunStatus.RUNNING,
          phase: TicketAutomationRunPhase.WORKSPACE_PREP,
          ticketStatusBefore: ticket.status,
          startedAt: new Date(),
          iterationCount: 0,
          completionMarkerSeen: false,
        }),
      );

      await leaseRepo.save(
        leaseRepo.create({
          ticketId: ticket.id,
          holderAgentId: agentId,
          runId: r.id,
          leaseVersion: 0,
          expiresAt: new Date(Date.now() + autonomy.maxRuntimeMs),
          status: TicketAutomationLeaseStatus.ACTIVE,
        }),
      );

      return r;
    });
  }

  /**
   * Workspace prep, agent loop, verification, and successful finalization (no broad catch — errors propagate).
   */
  private async executeRunWorkflow(
    run: TicketAutomationRunEntity,
    ticket: TicketEntity,
    automation: TicketAutomationEntity,
    autonomy: ClientAgentAutonomyEntity,
    agentId: string,
  ): Promise<void> {
    const branchesInitial = await this.vcsProxy.getBranches(ticket.clientId, agentId);
    const baseBranch =
      automation.defaultBranchOverride?.trim() ||
      branchesInitial.find((b) => b.name === 'main')?.name ||
      branchesInitial.find((b) => b.name === 'master')?.name ||
      branchesInitial.find((b) => !b.isRemote)?.name ||
      'main';

    await this.vcsProxy.prepareCleanWorkspace(ticket.clientId, agentId, { baseBranch });
    let stepIdx = 0;

    await this.persistStep(run.id, stepIdx++, TicketAutomationRunPhase.WORKSPACE_PREP, 'vcs_prepare', {
      baseBranch,
    });
    await this.emitRunSummaryNow(ticket.clientId, run.id);

    await this.vcsProxy.fetch(ticket.clientId, agentId);
    const branches = await this.vcsProxy.getBranches(ticket.clientId, agentId);
    const strategy: TicketAutomationBranchStrategy =
      automation.automationBranchStrategy ?? DEFAULT_TICKET_AUTOMATION_BRANCH_STRATEGY;
    const forceNext = automation.forceNewAutomationBranchNextRun === true;
    const useEphemeral = strategy === 'new_per_run' || forceNext;
    let branchName: string;
    let branchMode: 'ephemeral_new' | 'reuse_existing' | 'reuse_create';

    if (useEphemeral) {
      branchName = ephemeralAutomationBranchNameForRun(run.id);
      branchMode = 'ephemeral_new';
      await this.vcsProxy.createBranch(ticket.clientId, agentId, {
        name: branchName,
        baseBranch,
      });

      if (forceNext) {
        await this.automationRepo.update({ ticketId: ticket.id }, { forceNewAutomationBranchNextRun: false });
      }
    } else {
      branchName = stableAutomationBranchNameForTicket(ticket.id);

      if (listContainsBranchName(branches, branchName)) {
        branchMode = 'reuse_existing';
        await this.vcsProxy.switchBranch(ticket.clientId, agentId, branchName);
      } else {
        branchMode = 'reuse_create';
        await this.vcsProxy.createBranch(ticket.clientId, agentId, {
          name: branchName,
          baseBranch,
        });
      }
    }

    await this.persistStep(run.id, stepIdx++, TicketAutomationRunPhase.WORKSPACE_PREP, 'vcs_branch', {
      branchName,
      branchMode,
      strategy,
      forceNewBranchNextRunConsumed: forceNext,
    });
    await this.runRepo.update(run.id, { branchName, baseBranch });
    await this.emitRunSummaryNow(ticket.clientId, run.id);
    const contextInjection = {
      includeWorkspace: automation.includeWorkspaceContext !== false,
      environmentIds: [...new Set([agentId, ...(automation.contextEnvironmentIds ?? [])])],
      autoEnrichmentEnabled: automation.autoEnrichmentEnabled !== false,
    };

    if (autonomy.preImproveTicket) {
      await this.remoteChat.sendChatSync({
        clientId: ticket.clientId,
        agentId,
        message: `${buildAutonomousTicketRunPreamble()}Improve ticket clarity only; do not implement code yet.`,
        correlationId: `${run.id}:pre-improve`,
        continue: false,
        resumeSessionSuffix: '-ticket-auto-pre',
        statisticsInteractionKind: StatisticsInteractionKind.AUTONOMOUS_TICKET_RUN_TURN,
        contextInjection,
      });
    }

    let iteration = 0;
    let sawMarker = false;

    while (iteration < autonomy.maxIterations) {
      iteration += 1;
      const text = await this.remoteChat.sendChatSync({
        clientId: ticket.clientId,
        agentId,
        message:
          iteration === 1
            ? `${buildAutonomousTicketRunPreamble()}Implement the ticket in the repository.`
            : 'Continue the implementation until the completion marker is present.',
        correlationId: `${run.id}:turn:${iteration}`,
        continue: iteration > 1,
        resumeSessionSuffix: '-ticket-auto-loop',
        statisticsInteractionKind: StatisticsInteractionKind.AUTONOMOUS_TICKET_RUN_TURN,
        contextInjection,
      });

      await this.persistStep(run.id, stepIdx++, TicketAutomationRunPhase.AGENT_LOOP, 'agent_turn', { iteration }, text);
      await this.runRepo.update(run.id, { iterationCount: iteration, phase: TicketAutomationRunPhase.AGENT_LOOP });
      this.emitRunSummaryThrottled(ticket.clientId, run.id);

      if (text.includes(AGENSTRA_AUTOMATION_COMPLETE)) {
        sawMarker = true;
        await this.runRepo.update(run.id, { completionMarkerSeen: true });
        await this.emitRunSummaryNow(ticket.clientId, run.id);
        break;
      }
    }

    if (!sawMarker) {
      await this.failRun(run.id, TicketAutomationFailureCode.AGENT_NO_COMPLETION_MARKER);

      return;
    }

    const profile = automation.verifierProfile;

    if (profile?.commands?.length) {
      await this.runRepo.update(run.id, { phase: TicketAutomationRunPhase.VERIFY });
      await this.emitRunSummaryNow(ticket.clientId, run.id);
      const verify = await this.vcsProxy.runVerifierCommands(ticket.clientId, agentId, {
        commands: profile.commands,
        timeoutMs: 120_000,
      });
      const failed = verify.results.find((r) => r.exitCode !== 0);

      if (failed) {
        await this.runRepo.update(run.id, { verificationPassed: false });
        await this.emitRunSummaryNow(ticket.clientId, run.id);
        await this.failRun(run.id, TicketAutomationFailureCode.VERIFY_COMMAND_FAILED);

        return;
      }

      await this.runRepo.update(run.id, { verificationPassed: true });
      await this.emitRunSummaryNow(ticket.clientId, run.id);
    } else {
      this.logger.log(`Run ${run.id}: no verifier commands configured, skipping verification`);
    }

    const finalized = await this.finalizeGitCommitStep(run, ticket, agentId, stepIdx, contextInjection);

    if (!finalized.ok) {
      return;
    }

    stepIdx = finalized.nextStepIndex;

    ticket.status = TicketStatus.PROTOTYPE;
    await this.ticketRepo.save(ticket);
    await this.runRepo.update(run.id, {
      status: TicketAutomationRunStatus.SUCCEEDED,
      phase: TicketAutomationRunPhase.FINALIZE,
      finishedAt: new Date(),
    });
    await this.releaseLease(ticket.id);
    await this.appendSystemActivity(ticket.id, TicketActionType.AUTOMATION_SUCCEEDED, { runId: run.id });
    const successAutomationPatch: {
      consecutiveFailureCount: number;
      nextRetryAt: null;
      approvalBaselineTicketUpdatedAt?: Date;
    } = { consecutiveFailureCount: 0, nextRetryAt: null };

    if (automation.approvedAt) {
      const u = await this.ticketRepo.findOne({ where: { id: ticket.id }, select: ['updatedAt'] });

      if (u) {
        successAutomationPatch.approvalBaselineTicketUpdatedAt = u.updatedAt;
      }
    }

    await this.automationRepo.update({ ticketId: ticket.id }, successAutomationPatch);
    await this.emitRunSummaryNow(ticket.clientId, run.id);
    const autoAfter = await this.automationRepo.findOne({ where: { ticketId: ticket.id } });

    if (autoAfter) {
      this.ticketBoardRealtime.emitToClient(
        ticket.clientId,
        TICKETS_BOARD_EVENTS.ticketAutomationUpsert,
        this.ticketAutomationService.mapAutomationForBoard(autoAfter),
      );
    }

    await this.ticketsService.emitBoardTicketSnapshotInternal(ticket.id);
  }

  /**
   * After verification, stage all changes, propose a Conventional Commits subject via ephemeral remote chat
   * (or fallback), then `git commit` and `git push`. Skips commit/push when the working tree is already clean.
   */
  private async finalizeGitCommitStep(
    run: TicketAutomationRunEntity,
    ticket: TicketEntity,
    agentId: string,
    stepIdx: number,
    contextInjection: { includeWorkspace: boolean; environmentIds: string[]; autoEnrichmentEnabled: boolean },
  ): Promise<{ ok: true; nextStepIndex: number } | { ok: false }> {
    await this.runRepo.update(run.id, { phase: TicketAutomationRunPhase.FINALIZE });
    const status = await this.vcsProxy.getStatus(ticket.clientId, agentId);

    if (status.isClean) {
      this.logger.log(`Run ${run.id}: working tree clean, no git commit`);
      await this.persistStep(run.id, stepIdx++, TicketAutomationRunPhase.FINALIZE, 'git_commit', {
        skipped: true,
        reason: 'clean',
      });

      return { ok: true, nextStepIndex: stepIdx };
    }

    await this.vcsProxy.stageFiles(ticket.clientId, agentId, { files: [] });
    const { message, source } = await this.resolveCommitMessageWithAiFallback(run, ticket, agentId, contextInjection);

    try {
      await this.vcsProxy.commit(ticket.clientId, agentId, { message });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      this.logger.error(`Run ${run.id}: git commit failed: ${msg}`);
      await this.failRun(run.id, TicketAutomationFailureCode.COMMIT_FAILED);

      return { ok: false };
    }

    await this.persistStep(run.id, stepIdx++, TicketAutomationRunPhase.FINALIZE, 'git_commit', {
      message,
      messageSource: source,
    });

    try {
      await this.vcsProxy.push(ticket.clientId, agentId, {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      this.logger.error(`Run ${run.id}: git push failed: ${msg}`);
      await this.failRun(run.id, TicketAutomationFailureCode.PUSH_FAILED);

      return { ok: false };
    }

    await this.persistStep(run.id, stepIdx++, TicketAutomationRunPhase.FINALIZE, 'git_push', {});

    return { ok: true, nextStepIndex: stepIdx };
  }

  private async resolveCommitMessageWithAiFallback(
    run: TicketAutomationRunEntity,
    ticket: TicketEntity,
    agentId: string,
    contextInjection: { includeWorkspace: boolean; environmentIds: string[]; autoEnrichmentEnabled: boolean },
  ): Promise<{ message: string; source: 'ai' | 'fallback' }> {
    const timeoutMs = parseInt(process.env.REMOTE_AGENT_COMMIT_MESSAGE_TIMEOUT_MS || '120000', 10);

    try {
      const raw = await this.remoteChat.sendChatSync({
        clientId: ticket.clientId,
        agentId,
        message: buildAutonomousCommitMessagePrompt(ticket, run.branchName ?? ''),
        correlationId: `${run.id}:commit-msg`,
        continue: false,
        resumeSessionSuffix: '-ticket-auto-commit-msg',
        statisticsInteractionKind: StatisticsInteractionKind.AUTONOMOUS_TICKET_COMMIT_MESSAGE,
        chatTimeoutMs: timeoutMs,
        contextInjection,
      });
      const sanitized = sanitizeConventionalCommitSubject(raw);

      if (sanitized) {
        return { message: sanitized, source: 'ai' };
      }

      this.logger.warn(`Run ${run.id}: commit message AI output failed validation, using fallback`);
    } catch (e: unknown) {
      this.logger.warn(
        `Run ${run.id}: commit message generation failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return { message: buildFallbackAutonomousCommitMessage(ticket), source: 'fallback' };
  }

  private logOrchestratorError(runId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    this.logger.error(`Run ${runId} failed: ${message}`, stack);
  }

  private async failRun(runId: string, code: TicketAutomationFailureCode): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: runId } });

    if (!run) {
      return;
    }

    const ticket = await this.ticketRepo.findOne({ where: { id: run.ticketId } });

    if (!ticket) {
      return;
    }

    const steps = await this.stepRepo.find({ where: { runId } });
    const route = routeAutomationFailure(code);
    const runTerminal =
      code === TicketAutomationFailureCode.HUMAN_ESCALATION
        ? TicketAutomationRunStatus.ESCALATED
        : code === TicketAutomationFailureCode.AGENT_NO_COMPLETION_MARKER
          ? TicketAutomationRunStatus.TIMED_OUT
          : TicketAutomationRunStatus.FAILED;
    let nextStatus: TicketStatus;

    if (route.ticketStatus === 'unchanged') {
      nextStatus = run.ticketStatusBefore as TicketStatus;
    } else if (route.ticketStatus === TicketStatus.IN_PROGRESS) {
      const usable = isUsablePartialPrototype({
        branchName: run.branchName,
        hasNonZeroDiffAgainstMergeBase: !!run.branchName,
        iterationCount: run.iterationCount,
        hasAgentStepWithNonEmptyExcerpt: steps.some((s) => s.kind === 'agent_turn' && !!s.excerpt?.trim()),
      });

      nextStatus = usable ? TicketStatus.IN_PROGRESS : TicketStatus.TODO;
    } else {
      nextStatus = route.ticketStatus as TicketStatus;
    }

    ticket.status = nextStatus;
    await this.ticketRepo.save(ticket);
    await this.runRepo.update(runId, {
      status: runTerminal,
      failureCode: code,
      finishedAt: new Date(),
    });
    await this.releaseLease(run.ticketId);
    let activity = TicketActionType.AUTOMATION_FAILED;

    if (runTerminal === TicketAutomationRunStatus.TIMED_OUT) {
      activity = TicketActionType.AUTOMATION_TIMED_OUT;
    } else if (runTerminal === TicketAutomationRunStatus.ESCALATED) {
      activity = TicketActionType.AUTOMATION_ESCALATED;
    }

    await this.appendSystemActivity(run.ticketId, activity, { runId, code });

    const auto = await this.automationRepo.findOne({ where: { ticketId: run.ticketId } });
    const failAutomationPatch: {
      consecutiveFailureCount: number;
      nextRetryAt: Date | null;
      approvalBaselineTicketUpdatedAt?: Date;
    } = {
      consecutiveFailureCount: (auto?.consecutiveFailureCount ?? 0) + 1,
      nextRetryAt: route.requeue ? new Date(Date.now() + 60_000) : null,
    };

    if (auto?.approvedAt) {
      const u = await this.ticketRepo.findOne({ where: { id: ticket.id }, select: ['updatedAt'] });

      if (u) {
        failAutomationPatch.approvalBaselineTicketUpdatedAt = u.updatedAt;
      }
    }

    await this.automationRepo.update({ ticketId: run.ticketId }, failAutomationPatch);

    const refreshedRun = await this.safeFindRunById(runId);

    if (refreshedRun) {
      this.ticketBoardRealtime.emitToClient(
        ticket.clientId,
        TICKETS_BOARD_EVENTS.ticketAutomationRunUpsert,
        ticketAutomationRunEntityToDto(refreshedRun),
      );
      this.ticketAutomationChatSync.emitLiveRunUpdateFromEntity(refreshedRun);
    }

    const autoAfterFail = await this.automationRepo.findOne({ where: { ticketId: run.ticketId } });

    if (autoAfterFail) {
      this.ticketBoardRealtime.emitToClient(
        ticket.clientId,
        TICKETS_BOARD_EVENTS.ticketAutomationUpsert,
        this.ticketAutomationService.mapAutomationForBoard(autoAfterFail),
      );
    }

    await this.ticketsService.emitBoardTicketSnapshotInternal(run.ticketId);
  }

  private async releaseLease(ticketId: string): Promise<void> {
    await this.leaseRepo.update(
      { ticketId, status: TicketAutomationLeaseStatus.ACTIVE },
      { status: TicketAutomationLeaseStatus.RELEASED },
    );
  }

  private async persistStep(
    runId: string,
    index: number,
    phase: TicketAutomationRunPhase,
    kind: string,
    payload: Record<string, unknown>,
    excerpt?: string,
  ): Promise<void> {
    const saved = await this.stepRepo.save(
      this.stepRepo.create({
        runId,
        stepIndex: index,
        phase,
        kind,
        payload,
        excerpt: excerpt ?? null,
      }),
    );
    const runRow = await this.safeFindRunById(runId);

    if (runRow) {
      this.ticketBoardRealtime.emitToClient(runRow.clientId, TICKETS_BOARD_EVENTS.ticketAutomationRunStepAppended, {
        runId: runRow.id,
        step: ticketAutomationRunStepEntityToDto(saved),
      });
    }
  }

  private async appendSystemActivity(ticketId: string, action: TicketActionType, payload: Record<string, unknown>) {
    const row = await this.activityRepo.save(
      this.activityRepo.create({
        ticketId,
        actorType: TicketActorType.SYSTEM,
        actorUserId: null,
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

  private emitRunSummaryThrottled(clientId: string, runId: string): void {
    const now = Date.now();
    const last = this.lastRunSummaryEmitMs.get(runId) ?? 0;

    if (now - last < this.runSummaryEmitMinIntervalMs) {
      return;
    }

    this.lastRunSummaryEmitMs.set(runId, now);
    void this.emitRunSummaryNow(clientId, runId);
  }

  private async emitRunSummaryNow(clientId: string, runId: string): Promise<void> {
    const r = await this.safeFindRunById(runId);

    if (r) {
      this.ticketBoardRealtime.emitToClient(
        clientId,
        TICKETS_BOARD_EVENTS.ticketAutomationRunUpsert,
        ticketAutomationRunEntityToDto(r),
      );
      this.ticketAutomationChatSync.emitLiveRunUpdateFromEntity(r);
    }
  }

  /** Unit tests may supply partial repository mocks without `findOne`. */
  private async safeFindRunById(runId: string): Promise<TicketAutomationRunEntity | null> {
    const repo = this.runRepo as Pick<Repository<TicketAutomationRunEntity>, 'findOne'>;

    if (typeof repo.findOne !== 'function') {
      return null;
    }

    return repo.findOne({ where: { id: runId } });
  }
}
