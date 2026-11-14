import {
  DEPLOYMENT_LIMITS,
  DEPLOYMENT_RUN_STATUSES,
  isDeploymentRunActive,
  type AgentDeploymentActionSource,
  type DeploymentRunDetail,
  type DeploymentRunJobSummary,
  type DeploymentRunLogs,
  type DeploymentRunStatus,
  type DeploymentRunSummary,
  type DeploymentRunTriggerType,
  type DeploymentTriggerInput,
} from '@forepath/agenstra/shared/util-opencode-config';
import { ClientAgentCredentialsRepository } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository, type SelectQueryBuilder } from 'typeorm';

import { DEPLOYMENT_RUNS_DEFAULT_LIMIT, DEPLOYMENT_RUNS_MAX_LIMIT } from '../dto/deployments';
import { DeploymentRunEntity } from '../entities/deployment-run.entity';
import type { DeploymentWorkflowEntity } from '../entities/deployment-workflow.entity';
import { StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import type {
  DeploymentPipelineProvider,
  DeploymentProviderConnection,
  DeploymentProviderRunSnapshot,
} from '../providers/deployment/deployment-provider.interface';
import { mapDeploymentRunToSearchDocument } from '../search/agenstra-search-document.mapper';
import { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';
import {
  applyAgenstraSearchIlike,
  sanitizeListSearch,
  tryAgenstraSearchIds,
} from '../search/agenstra-search-list.util';
import { mergeDeploymentInputs, normalizeDeploymentInputs } from '../utils/deployment-inputs.utils';

import { AgentDeploymentSourcesService } from './agent-deployment-sources.service';
import {
  DEPLOYMENT_CONNECTION_NOT_AVAILABLE_MESSAGE,
  DeploymentConnectionsService,
} from './deployment-connections.service';
import { DeploymentRealtimeService } from './deployment-realtime.service';
import { DeploymentWorkflowsService } from './deployment-workflows.service';
import { StatisticsService } from './statistics.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Provider job ids (GitHub / GitLab numeric ids, Jenkins stage ids). */
const JOB_ID_PATTERN = /^[A-Za-z0-9_.:#-]{1,255}$/;

/** Recent provider runs read per workflow sync (history import + resolution of dispatched runs). */
export const DEPLOYMENT_SYNC_RUNS_LIMIT = 20;

/**
 * Dispatched runs the provider never reported (e.g. a GitHub dispatch whose run could not be matched) are closed as
 * `completed` / `neutral` after this time instead of being polled forever.
 */
export const DEPLOYMENT_UNRESOLVED_RUN_TIMEOUT_MS = 60 * 60_000;

/** Tolerated clock skew between the controller and the provider when matching dispatched runs. */
const DISPATCH_MATCH_SKEW_MS = 30_000;
/** Upper bound of OpenSearch ids considered for one run list search. */
const RUN_SEARCH_ID_LIMIT = 1_000;

export interface DeploymentRunListQuery {
  workflowId?: string;
  /** Runs triggered for / by this environment. */
  agentId?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface RunActor {
  type: Extract<DeploymentRunTriggerType, 'user' | 'agent'>;
  userId?: string | null;
  agentId?: string | null;
}

type WorkflowWithConnection = DeploymentWorkflowEntity;

interface ResolvedProvider {
  provider: DeploymentPipelineProvider;
  connection: DeploymentProviderConnection;
}

/** Minimum time between two syncs of one workflow requested by environments (MCP). */
export const DEPLOYMENT_AGENT_SYNC_MIN_INTERVAL_MS = 30_000;
const DEPLOYMENT_AGENT_SYNC_TRACKED_MAX = 1_000;

/**
 * Deployment runs (history, live status, logs) of a workspace. Access checks for workspace users happen in
 * {@link ClientDeploymentsController}; every lookup is scoped by `clientId`. Environments (`*ForAgent`, MCP) only reach
 * runs of enabled, approved workflows that are global or assigned to them, and only trigger / cancel when the workflow
 * has `agentTriggerEnabled` and the action source allows it ({@link AgentDeploymentSourcesService}). Nobody starts runs
 * of a pending workflow (proposed / changed by an environment, waiting for a workspace admin); the poller and the
 * history sync skip pending workflows (their repository may have changed since the runs were recorded).
 *
 * History and jobs are listed newest first by start time (`started_at`, falling back to the record time for runs
 * that did not start yet).
 *
 * Active runs are refreshed from the provider by {@link pollActiveRuns} (controller queue) and on detail reads; runs
 * started on the provider are imported as `external` by {@link syncHistory} / {@link sync}.
 */
@Injectable()
export class DeploymentRunsService {
  private readonly logger = new Logger(DeploymentRunsService.name);
  /** Last environment-requested sync per workflow (process-local throttle). */
  private readonly agentSyncAt = new Map<string, number>();
  /** Round-robin cursor over enabled workflows for {@link syncHistory} (best effort, per process). */
  private historyCursor = 0;

  constructor(
    @InjectRepository(DeploymentRunEntity)
    private readonly runRepo: Repository<DeploymentRunEntity>,
    private readonly workflows: DeploymentWorkflowsService,
    private readonly connections: DeploymentConnectionsService,
    private readonly clientAgentCredentialsRepository: ClientAgentCredentialsRepository,
    private readonly realtime: DeploymentRealtimeService,
    private readonly statisticsService: StatisticsService,
    private readonly sources: AgentDeploymentSourcesService,
    @Optional() private readonly searchIndex?: AgenstraSearchIndexService,
    @Optional() private readonly notificationPublisher?: AgenstraNotificationPublisher,
  ) {}

  // --- workspace users -------------------------------------------------------------------------------------

  /** Newest first, paged (`limit` default 25, max 100). */
  async list(
    clientId: string,
    query: DeploymentRunListQuery = {},
  ): Promise<{ items: DeploymentRunSummary[]; total: number }> {
    const limit = this.boundLimit(query.limit);
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const qb = this.runRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.workflowEntity', 'w')
      .where('r.client_id = :clientId', { clientId });

    if (query.workflowId) {
      qb.andWhere('r.workflow_id = :workflowId', { workflowId: query.workflowId });
    }

    if (query.agentId) {
      qb.andWhere('r.agent_id = :agentId', { agentId: query.agentId });
    }

    if (query.status !== undefined && query.status !== '') {
      qb.andWhere('r.status = :status', { status: this.requireStatus(query.status) });
    }

    const search = sanitizeListSearch(query.search);

    if (search) {
      const lookup = await tryAgenstraSearchIds(
        this.searchIndex,
        { entityType: 'deployment-runs', query: search, clientIds: [clientId], limit: RUN_SEARCH_ID_LIMIT },
        this.logger,
      );

      if (lookup && lookup.ids.length > 0) {
        qb.andWhere('r.id IN (:...searchIds)', { searchIds: lookup.ids });
      } else {
        applyAgenstraSearchIlike(qb, 'deployment-runs', 'r', search, { name: 'w.name' });
      }
    }

    const [rows, total] = await orderRunsNewestFirst(qb).offset(offset).limit(limit).getManyAndCount();

    return { items: rows.map((row) => this.toSummary(row)), total };
  }

  /** Active runs are refreshed from the provider first (best effort). */
  async getDetail(clientId: string, runId: string): Promise<DeploymentRunDetail> {
    return await this.detail(await this.findRunOrThrow(clientId, runId));
  }

  async getLogs(clientId: string, runId: string, jobId?: string): Promise<DeploymentRunLogs> {
    return await this.logs(await this.findRunOrThrow(clientId, runId), jobId, DEPLOYMENT_LIMITS.logsMaxBytes);
  }

  async trigger(
    clientId: string,
    workflowId: string,
    input: DeploymentTriggerInput & { agentId?: string },
    userId?: string | null,
  ): Promise<DeploymentRunSummary> {
    const workflow = await this.workflows.findOrThrow(clientId, workflowId);
    const agentId = input.agentId ? input.agentId.trim().toLowerCase() : null;

    DeploymentWorkflowsService.assertApproved(workflow);

    if (agentId) {
      if (
        !UUID_V4.test(agentId) ||
        !(await this.clientAgentCredentialsRepository.findByClientAndAgent(clientId, agentId))
      ) {
        throw new BadRequestException('Environment not found in this workspace');
      }

      if (!DeploymentWorkflowsService.isAvailableToAgent(workflow, agentId)) {
        throw new ForbiddenException('This workflow is not available to the environment');
      }
    }

    return await this.triggerInternal(workflow, input, { type: 'user', userId: userId ?? null, agentId });
  }

  async cancel(clientId: string, runId: string, userId?: string | null): Promise<DeploymentRunSummary> {
    return await this.cancelInternal(await this.findRunOrThrow(clientId, runId), { type: 'user', userId });
  }

  /** Imports recent provider runs of the workflow as `external` and refreshes the active ones. */
  async sync(clientId: string, workflowId: string): Promise<{ synced: number }> {
    const workflow = await this.workflows.findOrThrow(clientId, workflowId);

    DeploymentWorkflowsService.assertApproved(workflow);
    this.assertConnectionUsable(workflow);

    return { synced: await this.syncWorkflow(workflow) };
  }

  // --- environments (manager socket) -------------------------------------------------------------------------

  /**
   * Environment-requested history sync of a workflow it may use (enabled, approved, available). Read-only towards the
   * provider, so no agent-trigger permission is needed; throttled per workflow so environments cannot flood the
   * provider API.
   */
  async syncForAgent(clientId: string, agentId: string, workflowId: string): Promise<{ synced: number }> {
    const workflow = await this.workflows.findForAgentOrThrow(clientId, agentId, workflowId);
    const now = Date.now();
    const last = this.agentSyncAt.get(workflow.id);

    if (last !== undefined && now - last < DEPLOYMENT_AGENT_SYNC_MIN_INTERVAL_MS) {
      throw new ConflictException(
        `This workflow was synced less than ${Math.round(DEPLOYMENT_AGENT_SYNC_MIN_INTERVAL_MS / 1000)} seconds ago; ` +
          'try again later.',
      );
    }

    this.assertConnectionUsable(workflow as WorkflowWithConnection);
    this.agentSyncAt.set(workflow.id, now);

    if (this.agentSyncAt.size > DEPLOYMENT_AGENT_SYNC_TRACKED_MAX) {
      for (const [id, at] of this.agentSyncAt) {
        if (now - at >= DEPLOYMENT_AGENT_SYNC_MIN_INTERVAL_MS) {
          this.agentSyncAt.delete(id);
        }
      }
    }

    return { synced: await this.syncWorkflow(workflow as WorkflowWithConnection) };
  }

  async listForAgent(
    clientId: string,
    agentId: string,
    options: { workflowId?: string; limit?: number } = {},
  ): Promise<DeploymentRunSummary[]> {
    const available = await this.workflows.findAvailableForAgent(clientId, agentId);
    let workflowIds = available.map((workflow) => workflow.id);

    if (options.workflowId !== undefined) {
      if (!workflowIds.includes(options.workflowId)) {
        throw new NotFoundException('Deployment workflow not found');
      }

      workflowIds = [options.workflowId];
    }

    if (workflowIds.length === 0) {
      return [];
    }

    const rows = await orderRunsNewestFirst(
      this.runRepo
        .createQueryBuilder('r')
        .leftJoinAndSelect('r.workflowEntity', 'w')
        .where('r.client_id = :clientId', { clientId })
        .andWhere('r.workflow_id IN (:...workflowIds)', { workflowIds }),
    )
      .limit(this.boundLimit(options.limit))
      .getMany();

    return rows.map((row) => this.toSummary(row));
  }

  async getForAgent(clientId: string, agentId: string, runId: string): Promise<DeploymentRunDetail> {
    return await this.detail(await this.findRunForAgentOrThrow(clientId, agentId, runId));
  }

  async getLogsForAgent(clientId: string, agentId: string, runId: string, jobId?: string): Promise<DeploymentRunLogs> {
    return await this.logs(
      await this.findRunForAgentOrThrow(clientId, agentId, runId),
      jobId,
      DEPLOYMENT_LIMITS.agentLogsMaxBytes,
    );
  }

  /**
   * Run requested by an environment. The action source (chat approval / task / ticket automation opt-in) is checked
   * first, then the workflow rules: enabled + approved + available (404 / 409 for its own pending workflows),
   * `agentTriggerEnabled`, default ref only, defined inputs only.
   */
  async triggerForAgent(
    clientId: string,
    agentId: string,
    workflowId: string,
    input: DeploymentTriggerInput,
    source: AgentDeploymentActionSource,
  ): Promise<DeploymentRunSummary> {
    await this.sources.assertSourceAllows(clientId, agentId, source, 'deployment.trigger');

    const workflow = await this.workflows.findForAgentOrThrow(clientId, agentId, workflowId);

    this.assertAgentTriggerEnabled(workflow);

    return await this.triggerInternal(workflow, this.restrictAgentTriggerInput(workflow, input), {
      type: 'agent',
      agentId,
    });
  }

  /**
   * Environments deploy what the workspace configured: the workflow's default ref only (an environment can push
   * branches, so a free ref would let it run a modified workflow file / pipeline with the deployment secrets), and only
   * overrides of the inputs the workflow defines (no arbitrary pipeline variables such as `CI_DEBUG_TRACE`).
   */
  private restrictAgentTriggerInput(
    workflow: WorkflowWithConnection,
    input: DeploymentTriggerInput,
  ): DeploymentTriggerInput {
    const requestedRef = typeof input?.ref === 'string' ? input.ref.trim() : '';

    if (requestedRef && requestedRef !== (workflow.defaultRef ?? '').trim()) {
      throw new ForbiddenException('Environments can only deploy the default ref of the workflow');
    }

    const allowed = new Set(Object.keys(workflow.defaultInputs ?? {}));
    const unknown = Object.keys(normalizeDeploymentInputs(input?.inputs)).filter((key) => !allowed.has(key));

    if (unknown.length) {
      throw new ForbiddenException(
        `Environments can only set the inputs the workflow defines (not allowed: ${unknown.slice(0, 5).join(', ')})`,
      );
    }

    return { inputs: input?.inputs };
  }

  async cancelForAgent(
    clientId: string,
    agentId: string,
    runId: string,
    source: AgentDeploymentActionSource,
  ): Promise<DeploymentRunSummary> {
    await this.sources.assertSourceAllows(clientId, agentId, source, 'deployment.cancel');

    const run = await this.findRunForAgentOrThrow(clientId, agentId, runId);

    this.assertAgentTriggerEnabled(run.workflowEntity as WorkflowWithConnection);

    return await this.cancelInternal(run, { type: 'agent', agentId });
  }

  // --- scheduler (controller queue) --------------------------------------------------------------------------

  /**
   * Refreshes up to `limit` active runs (least recently refreshed first) of approved workflows; returns the number
   * processed.
   */
  async pollActiveRuns(limit: number): Promise<number> {
    const runs = await this.runRepo.find({
      where: {
        status: In(DEPLOYMENT_RUN_STATUSES.filter((status) => isDeploymentRunActive(status))),
        workflowEntity: { approvedAt: Not(IsNull()) },
      },
      relations: { workflowEntity: { connection: true } },
      order: { updatedAt: 'ASC', id: 'ASC' },
      take: Math.max(1, limit),
    });
    const touchedWorkflows = new Set<string>();

    for (const run of runs) {
      try {
        if (await this.refreshRun(run, { skipLastRun: true })) {
          touchedWorkflows.add(run.workflowId);
        } else {
          // Rotate: untouched runs move behind the others for the next poll.
          await this.runRepo.update({ id: run.id }, { updatedAt: new Date() });
        }
      } catch (error) {
        this.logger.warn(`Deployment run ${run.id} refresh failed: ${this.errorMessage(error)}`);
        await this.runRepo.update({ id: run.id }, { updatedAt: new Date() }).catch(() => undefined);
      }
    }

    await this.refreshWorkflows(touchedWorkflows);

    return runs.length;
  }

  /** Imports external runs for up to `limit` enabled workflows (round robin); returns the number of synced runs. */
  async syncHistory(limit: number): Promise<number> {
    const batch = Math.max(1, limit);
    const workflows = await this.workflows.findEnabledBatch(this.historyCursor, batch);

    this.historyCursor = workflows.length < batch ? 0 : this.historyCursor + workflows.length;

    let synced = 0;

    for (const workflow of workflows) {
      if (!this.isConnectionUsable(workflow)) {
        continue;
      }

      try {
        synced += await this.syncWorkflow(workflow);
      } catch (error) {
        this.logger.warn(`Deployment workflow ${workflow.id} history sync failed: ${this.errorMessage(error)}`);
      }
    }

    return synced;
  }

  // --- internals -----------------------------------------------------------------------------------------------

  private async triggerInternal(
    workflow: WorkflowWithConnection,
    input: DeploymentTriggerInput,
    actor: RunActor,
  ): Promise<DeploymentRunSummary> {
    if (!workflow.enabled) {
      throw new ConflictException('Deployment workflow is disabled');
    }

    DeploymentWorkflowsService.assertApproved(workflow);

    const resolved = this.resolveProvider(workflow);
    const inputs = mergeDeploymentInputs(workflow.defaultInputs, normalizeDeploymentInputs(input.inputs));
    const ref = await this.resolveRef(workflow, resolved, input.ref);
    const snapshot = await resolved.provider.trigger(resolved.connection, {
      repository: workflow.repository,
      workflow: workflow.workflow ?? null,
      ref,
      inputs,
    });
    const saved = await this.runRepo.save(
      this.runRepo.create({
        clientId: workflow.clientId,
        workflowId: workflow.id,
        agentId: actor.agentId ?? null,
        providerRunId: snapshot.providerRunId,
        name: this.boundName(snapshot.name) ?? workflow.name,
        status: snapshot.status,
        conclusion: snapshot.conclusion,
        ref: snapshot.ref ?? ref,
        sha: snapshot.sha,
        url: snapshot.url,
        inputs,
        triggeredByType: actor.type,
        triggeredByUserId: actor.type === 'user' ? (actor.userId ?? null) : null,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
      }),
    );

    saved.workflowEntity = workflow;

    const summary = this.toSummary(saved);

    this.publishRun(saved, summary);
    this.notificationPublisher?.publishDeploymentRun('deployment_run.created', summary);
    this.statisticsService
      .recordEntityCreated(
        StatisticsEntityType.DEPLOYMENT_RUN,
        saved.id,
        { clientId: workflow.clientId, agentId: saved.agentId ?? undefined, workflowId: workflow.id },
        actor.userId ?? undefined,
      )
      .catch(() => undefined);
    await this.workflows.refreshLastRun(workflow.id);

    return summary;
  }

  private async cancelInternal(run: DeploymentRunEntity, actor: RunActor): Promise<DeploymentRunSummary> {
    const workflow = run.workflowEntity as WorkflowWithConnection;

    if (!isDeploymentRunActive(run.status)) {
      throw new ConflictException('Deployment run is not active');
    }

    if (!run.providerRunId) {
      throw new ConflictException('The run has not started on the provider yet; try again shortly');
    }

    // A pending workflow may point at another repository than the one the run was recorded for.
    DeploymentWorkflowsService.assertApproved(workflow);

    const resolved = this.resolveProvider(workflow);

    await resolved.provider.cancelRun(resolved.connection, workflow.repository, run.providerRunId);

    try {
      await this.refreshRun(run, { resolved });
    } catch (error) {
      this.logger.warn(`Deployment run ${run.id} refresh after cancel failed: ${this.errorMessage(error)}`);
    }

    this.statisticsService
      .recordEntityUpdated(
        StatisticsEntityType.DEPLOYMENT_RUN,
        run.id,
        { clientId: run.clientId, agentId: run.agentId ?? undefined, action: 'cancelled' },
        actor.userId ?? undefined,
      )
      .catch(() => undefined);

    return this.toSummary(run);
  }

  private async detail(run: DeploymentRunEntity): Promise<DeploymentRunDetail> {
    const workflow = run.workflowEntity as WorkflowWithConnection;
    // Pending workflows are not read from the provider (their repository may have changed since the run).
    const resolved =
      workflow.approvedAt && this.isConnectionUsable(workflow) ? this.tryResolveProvider(workflow) : null;
    let jobs: DeploymentRunJobSummary[] = [];

    if (resolved) {
      if (isDeploymentRunActive(run.status)) {
        try {
          await this.refreshRun(run, { resolved });
        } catch (error) {
          this.logger.warn(`Deployment run ${run.id} refresh failed: ${this.errorMessage(error)}`);
        }
      }

      if (run.providerRunId) {
        try {
          jobs = sortDeploymentJobsNewestFirst(
            await resolved.provider.listJobs(resolved.connection, workflow.repository, run.providerRunId),
          );
        } catch (error) {
          this.logger.warn(`Deployment run ${run.id} jobs failed: ${this.errorMessage(error)}`);
        }
      }
    }

    return { run: this.toSummary(run), jobs };
  }

  private async logs(
    run: DeploymentRunEntity,
    jobId: string | undefined,
    maxBytes: number,
  ): Promise<DeploymentRunLogs> {
    const workflow = run.workflowEntity as WorkflowWithConnection;
    const job = jobId === undefined || jobId === '' ? undefined : jobId.trim();

    if (job !== undefined && !JOB_ID_PATTERN.test(job)) {
      throw new BadRequestException('Invalid job id');
    }

    DeploymentWorkflowsService.assertApproved(workflow);

    const resolved = this.resolveProvider(workflow);

    if (!run.providerRunId) {
      return { logs: '', truncated: false };
    }

    if (job !== undefined) {
      // Provider job log endpoints are repository scoped (GitHub / GitLab do not check the run), so a job id is only
      // accepted when it belongs to this run; otherwise logs of other workflows of the repository would be reachable.
      const jobs = await resolved.provider.listJobs(resolved.connection, workflow.repository, run.providerRunId);

      if (!jobs.some((candidate) => candidate.id === job)) {
        throw new NotFoundException('Deployment job not found');
      }
    }

    const result = job
      ? await resolved.provider.getJobLogs(resolved.connection, workflow.repository, run.providerRunId, job, maxBytes)
      : await resolved.provider.getRunLogs(resolved.connection, workflow.repository, run.providerRunId, maxBytes);

    return capDeploymentLogs(result, maxBytes);
  }

  /** Imports / updates the recent provider runs of one workflow; returns the number of new or changed runs. */
  private async syncWorkflow(workflow: WorkflowWithConnection): Promise<number> {
    const resolved = this.resolveProvider(workflow);
    const snapshots = await resolved.provider.listRuns(resolved.connection, {
      repository: workflow.repository,
      workflow: workflow.workflow ?? null,
      limit: DEPLOYMENT_SYNC_RUNS_LIMIT,
    });
    let synced = await this.resolvePendingRuns(workflow, resolved, snapshots);

    for (const snapshot of snapshots) {
      if (!snapshot.providerRunId) {
        continue;
      }

      const existing = await this.runRepo.findOne({
        where: { workflowId: workflow.id, providerRunId: snapshot.providerRunId },
      });

      if (existing) {
        existing.workflowEntity = workflow;

        if (await this.applySnapshot(existing, snapshot)) {
          synced++;
        }

        continue;
      }

      const created = await this.runRepo.save(
        this.runRepo.create({
          clientId: workflow.clientId,
          workflowId: workflow.id,
          agentId: null,
          providerRunId: snapshot.providerRunId,
          name: this.boundName(snapshot.name) ?? workflow.name,
          status: snapshot.status,
          conclusion: snapshot.conclusion,
          ref: snapshot.ref,
          sha: snapshot.sha,
          url: snapshot.url,
          inputs: {},
          triggeredByType: 'external',
          triggeredByUserId: null,
          startedAt: snapshot.startedAt,
          completedAt: snapshot.completedAt,
        }),
      );

      created.workflowEntity = workflow;
      this.publishRun(created, this.toSummary(created));
      synced++;
    }

    if (synced > 0) {
      await this.workflows.refreshLastRun(workflow.id);
    }

    return synced;
  }

  /**
   * Refreshes one active run. Runs without provider run id (GitHub dispatches) are matched against recent provider
   * runs; Jenkins queue items (`queue:{id}`) get their build id from `getRun`. Returns whether the run changed.
   */
  private async refreshRun(
    run: DeploymentRunEntity,
    options: { resolved?: ResolvedProvider; skipLastRun?: boolean } = {},
  ): Promise<boolean> {
    const workflow = run.workflowEntity as WorkflowWithConnection;

    if (!isDeploymentRunActive(run.status)) {
      return false;
    }

    if (!options.resolved && !this.isConnectionUsable(workflow)) {
      return false;
    }

    const resolved = options.resolved ?? this.resolveProvider(workflow);
    let changed: boolean;

    if (!run.providerRunId) {
      changed = (await this.resolvePendingRuns(workflow, resolved, null, run)) > 0;

      if (!run.providerRunId && Date.now() - run.createdAt.getTime() > DEPLOYMENT_UNRESOLVED_RUN_TIMEOUT_MS) {
        changed =
          (await this.applySnapshot(run, {
            ...this.snapshotOf(run),
            status: 'completed',
            conclusion: 'neutral',
            completedAt: new Date(),
          })) || changed;
      }
    } else {
      changed = await this.applySnapshot(
        run,
        await resolved.provider.getRun(resolved.connection, workflow.repository, run.providerRunId),
      );
    }

    if (changed && !options.skipLastRun) {
      await this.workflows.refreshLastRun(workflow.id);
    }

    return changed;
  }

  /**
   * Assigns provider runs to recorded runs that were dispatched without a provider run id (oldest first). GitHub
   * resolves the `workflow_dispatch` run itself (`resolveDispatchedRun`); other providers match recent runs (`listRuns`,
   * or `snapshots` when the caller already loaded them). The provider run must use the same ref, must not be claimed
   * by another Agenstra run and must have started after the dispatch. An `external` copy imported meanwhile is merged
   * into the recorded run.
   */
  private async resolvePendingRuns(
    workflow: WorkflowWithConnection,
    resolved: ResolvedProvider,
    snapshots: DeploymentProviderRunSnapshot[] | null,
    only?: DeploymentRunEntity,
  ): Promise<number> {
    const pending = only
      ? [only]
      : await this.runRepo.find({
          where: { workflowId: workflow.id, providerRunId: IsNull(), status: In(['queued', 'in_progress']) },
          order: { createdAt: 'ASC' },
        });

    if (pending.length === 0) {
      return 0;
    }

    const dispatchResolver = dispatchedRunResolver(resolved.provider);
    let recent: DeploymentProviderRunSnapshot[] = [];

    if (dispatchResolver) {
      for (const run of pending) {
        if (!run.ref || !workflow.workflow) {
          continue;
        }

        const found = await dispatchResolver(resolved.connection, {
          repository: workflow.repository,
          workflow: workflow.workflow,
          ref: run.ref,
          dispatchedAt: new Date(run.createdAt.getTime() - DISPATCH_MATCH_SKEW_MS),
        });

        if (found?.providerRunId && !recent.some((snapshot) => snapshot.providerRunId === found.providerRunId)) {
          recent.push(found);
        }
      }
    } else {
      recent =
        snapshots ??
        (await resolved.provider.listRuns(resolved.connection, {
          repository: workflow.repository,
          workflow: workflow.workflow ?? null,
          limit: DEPLOYMENT_SYNC_RUNS_LIMIT,
        }));
    }

    const candidates = recent
      .filter((snapshot) => snapshot.providerRunId)
      .sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0));

    if (candidates.length === 0) {
      return 0;
    }

    const existing = await this.runRepo.find({
      where: {
        workflowId: workflow.id,
        providerRunId: In(candidates.map((snapshot) => snapshot.providerRunId as string)),
      },
    });
    const existingByProviderId = new Map(existing.map((row) => [row.providerRunId as string, row]));
    const claimed = new Set<string>();
    let resolvedCount = 0;

    for (const run of pending) {
      const match = candidates.find((snapshot) => {
        const id = snapshot.providerRunId as string;
        const other = existingByProviderId.get(id);

        return (
          !claimed.has(id) &&
          (!other || other.triggeredByType === 'external') &&
          (!run.ref || !snapshot.ref || snapshot.ref === run.ref) &&
          (!snapshot.startedAt || snapshot.startedAt.getTime() >= run.createdAt.getTime() - DISPATCH_MATCH_SKEW_MS)
        );
      });

      if (!match) {
        continue;
      }

      const providerRunId = match.providerRunId as string;
      const duplicate = existingByProviderId.get(providerRunId);

      claimed.add(providerRunId);

      if (duplicate) {
        await this.runRepo.delete({ id: duplicate.id });
        void this.searchIndex?.deleteSafe('deployment-runs', duplicate.id);
      }

      run.workflowEntity = workflow;

      if (await this.applySnapshot(run, match)) {
        resolvedCount++;
      }
    }

    return resolvedCount;
  }

  /** Writes the provider view onto the run; emits and indexes when something changed. */
  private async applySnapshot(run: DeploymentRunEntity, snapshot: DeploymentProviderRunSnapshot): Promise<boolean> {
    const previousStatus = run.status;
    const patch: Partial<DeploymentRunEntity> = {};
    const name = this.boundName(snapshot.name);

    if (snapshot.providerRunId && snapshot.providerRunId !== run.providerRunId) {
      await this.mergeExternalDuplicate(run, snapshot.providerRunId);
      patch.providerRunId = snapshot.providerRunId;
    }

    if (name && name !== run.name) patch.name = name;

    if (snapshot.status !== run.status) patch.status = snapshot.status;

    if ((snapshot.conclusion ?? null) !== (run.conclusion ?? null)) patch.conclusion = snapshot.conclusion ?? null;

    if (snapshot.ref && snapshot.ref !== run.ref) patch.ref = snapshot.ref;

    if (snapshot.sha && snapshot.sha !== run.sha) patch.sha = snapshot.sha;

    if (snapshot.url && snapshot.url !== run.url) patch.url = snapshot.url;

    if (snapshot.startedAt && snapshot.startedAt.getTime() !== run.startedAt?.getTime()) {
      patch.startedAt = snapshot.startedAt;
    }

    if (snapshot.completedAt && snapshot.completedAt.getTime() !== run.completedAt?.getTime()) {
      patch.completedAt = snapshot.completedAt;
    }

    if (Object.keys(patch).length === 0) {
      return false;
    }

    await this.runRepo.update({ id: run.id }, patch);
    Object.assign(run, patch, { updatedAt: new Date() });

    const summary = this.toSummary(run);

    this.publishRun(run, summary);

    if (isDeploymentRunActive(previousStatus) && !isDeploymentRunActive(run.status)) {
      this.notificationPublisher?.publishDeploymentRun('deployment_run.completed', summary);
    }

    return true;
  }

  /** A provider run imported as `external` before it was matched to this run is folded into it. */
  private async mergeExternalDuplicate(run: DeploymentRunEntity, providerRunId: string): Promise<void> {
    const other = await this.runRepo.findOne({ where: { workflowId: run.workflowId, providerRunId } });

    if (!other || other.id === run.id) {
      return;
    }

    if (other.triggeredByType !== 'external') {
      throw new ConflictException('Provider run is already recorded for another run');
    }

    await this.runRepo.delete({ id: other.id });
    void this.searchIndex?.deleteSafe('deployment-runs', other.id);
  }

  private publishRun(run: DeploymentRunEntity, summary: DeploymentRunSummary): void {
    this.realtime.emitRunUpsert(summary);
    void this.searchIndex?.upsertSafe('deployment-runs', mapDeploymentRunToSearchDocument(run));
  }

  private async refreshWorkflows(workflowIds: Set<string>): Promise<void> {
    for (const workflowId of workflowIds) {
      try {
        await this.workflows.refreshLastRun(workflowId);
      } catch (error) {
        this.logger.warn(`Deployment workflow ${workflowId} last-run refresh failed: ${this.errorMessage(error)}`);
      }
    }
  }

  /**
   * Explicit ref, else the workflow default ref, else the repository default branch (provider); without any of them
   * the trigger is rejected.
   */
  private async resolveRef(
    workflow: WorkflowWithConnection,
    resolved: ResolvedProvider,
    requested: string | undefined,
  ): Promise<string> {
    if (requested !== undefined && requested !== null) {
      if (typeof requested !== 'string') {
        throw new BadRequestException('ref must be a string');
      }

      const ref = requested.trim();

      if (!ref || ref.length > DEPLOYMENT_LIMITS.refMaxLength || hasControlCharacters(ref)) {
        throw new BadRequestException(`ref must be 1-${DEPLOYMENT_LIMITS.refMaxLength} printable characters`);
      }

      return ref;
    }

    if (workflow.defaultRef) {
      return workflow.defaultRef;
    }

    try {
      const branches = await resolved.provider.listBranches(resolved.connection, workflow.repository);
      const defaultBranch = branches.find((branch) => branch.default)?.name;

      if (defaultBranch) {
        return defaultBranch;
      }
    } catch (error) {
      this.logger.debug(`Default branch lookup for workflow ${workflow.id} failed: ${this.errorMessage(error)}`);
    }

    throw new BadRequestException('ref is required (the workflow has no default ref)');
  }

  /** 403 when the connection was revoked for the workspace; credentials are resolved by the connections service. */
  private resolveProvider(workflow: WorkflowWithConnection): ResolvedProvider {
    this.assertConnectionUsable(workflow);

    return this.connections.providerFor(workflow.connection as NonNullable<typeof workflow.connection>);
  }

  private tryResolveProvider(workflow: WorkflowWithConnection): ResolvedProvider | null {
    try {
      return this.resolveProvider(workflow);
    } catch (error) {
      this.logger.debug(`Deployment provider for workflow ${workflow.id} unavailable: ${this.errorMessage(error)}`);

      return null;
    }
  }

  private assertConnectionUsable(workflow: WorkflowWithConnection): void {
    if (!workflow.connection) {
      throw new ForbiddenException(DEPLOYMENT_CONNECTION_NOT_AVAILABLE_MESSAGE);
    }

    this.connections.assertUsableByClient(workflow.connection, workflow.clientId);
  }

  private isConnectionUsable(workflow: WorkflowWithConnection | undefined): boolean {
    return Boolean(workflow?.connection && this.connections.isUsableByClient(workflow.connection, workflow.clientId));
  }

  private assertAgentTriggerEnabled(workflow: WorkflowWithConnection): void {
    if (!workflow.agentTriggerEnabled) {
      throw new ForbiddenException('This workflow does not allow environments to trigger or cancel runs');
    }
  }

  private async findRunOrThrow(clientId: string, runId: string): Promise<DeploymentRunEntity> {
    const run = UUID_V4.test(runId)
      ? await this.runRepo.findOne({
          where: { id: runId, clientId },
          relations: { workflowEntity: { connection: true } },
        })
      : null;

    if (!run || !run.workflowEntity) {
      throw new NotFoundException('Deployment run not found');
    }

    return run;
  }

  /** Runs of workflows the environment may not use are indistinguishable from missing ones. */
  private async findRunForAgentOrThrow(clientId: string, agentId: string, runId: string): Promise<DeploymentRunEntity> {
    const run = await this.findRunOrThrow(clientId, runId).catch(() => null);
    const workflow = run?.workflowEntity;

    if (!run || !workflow || !DeploymentWorkflowsService.isUsableByAgent(workflow, agentId)) {
      throw new NotFoundException('Deployment run not found');
    }

    return run;
  }

  toSummary(run: DeploymentRunEntity): DeploymentRunSummary {
    return {
      id: run.id,
      clientId: run.clientId,
      workflowId: run.workflowId,
      workflowName: run.workflowEntity?.name ?? '',
      agentId: run.agentId ?? null,
      providerRunId: run.providerRunId ?? null,
      name: run.name ?? null,
      status: run.status,
      conclusion: run.conclusion ?? null,
      ref: run.ref ?? null,
      sha: run.sha ?? null,
      url: run.url ?? null,
      inputs: { ...(run.inputs ?? {}) },
      triggeredBy: run.triggeredByType,
      triggeredByUserId: run.triggeredByUserId ?? null,
      startedAt: run.startedAt ? run.startedAt.toISOString() : null,
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private snapshotOf(run: DeploymentRunEntity): DeploymentProviderRunSnapshot {
    return {
      providerRunId: run.providerRunId ?? null,
      name: run.name ?? null,
      status: run.status,
      conclusion: run.conclusion ?? null,
      ref: run.ref ?? null,
      sha: run.sha ?? null,
      url: run.url ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
    };
  }

  private requireStatus(value: string): DeploymentRunStatus {
    if (!(DEPLOYMENT_RUN_STATUSES as readonly string[]).includes(value)) {
      throw new BadRequestException(`status must be one of ${DEPLOYMENT_RUN_STATUSES.join(', ')}`);
    }

    return value as DeploymentRunStatus;
  }

  private boundLimit(value: number | undefined): number {
    return Math.min(Math.max(1, Math.floor(value ?? DEPLOYMENT_RUNS_DEFAULT_LIMIT)), DEPLOYMENT_RUNS_MAX_LIMIT);
  }

  /** Run names are stored in a 255 character column. */
  private boundName(value: string | null | undefined): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';

    return trimmed ? trimmed.slice(0, 255) : null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Newest first by start time: `started_at`, else the record time (dispatched runs that did not start yet), then id.
 * Runs imported from the provider get `created_at` at sync time, so the provider start has to win.
 *
 * The workflow join is many-to-one (no row multiplication), so plain SQL `LIMIT` / `OFFSET` (`limit` / `offset`) page
 * exactly; TypeORM's `skip` / `take` would wrap the query in a DISTINCT id subquery that cannot order by the computed
 * `COALESCE` alias.
 */
function orderRunsNewestFirst<T extends SelectQueryBuilder<DeploymentRunEntity>>(qb: T): T {
  qb.addSelect('COALESCE(r.started_at, r.created_at)', 'deployment_run_sort_at')
    .orderBy('deployment_run_sort_at', 'DESC')
    .addOrderBy('r.id', 'DESC');

  return qb;
}

/** Jobs newest first by start time; jobs without start time last; provider order otherwise (stable). */
export function sortDeploymentJobsNewestFirst(jobs: readonly DeploymentRunJobSummary[]): DeploymentRunJobSummary[] {
  const startOf = (job: DeploymentRunJobSummary): number | null => {
    const time = job.startedAt ? Date.parse(job.startedAt) : Number.NaN;

    return Number.isNaN(time) ? null : time;
  };

  return jobs
    .map((job, index) => ({ job, index, start: startOf(job) }))
    .sort((a, b) => {
      if (a.start !== null && b.start !== null && a.start !== b.start) {
        return b.start - a.start;
      }

      if ((a.start === null) !== (b.start === null)) {
        return a.start === null ? 1 : -1;
      }

      return a.index - b.index;
    })
    .map(({ job }) => job);
}

type DispatchedRunResolver = (
  connection: DeploymentProviderConnection,
  request: { repository: string; workflow: string; ref: string; dispatchedAt: Date },
) => Promise<DeploymentProviderRunSnapshot | null>;

/** Providers that can look up the run created by a dispatch (GitHub `resolveDispatchedRun`). */
function dispatchedRunResolver(provider: DeploymentPipelineProvider): DispatchedRunResolver | null {
  const candidate = (provider as { resolveDispatchedRun?: unknown }).resolveDispatchedRun;

  return typeof candidate === 'function' ? (candidate as DispatchedRunResolver).bind(provider) : null;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);

    return code < 0x20 || code === 0x7f;
  });
}

/** Tail of the logs within `maxBytes` (UTF-8), defensive against providers ignoring the limit. */
export function capDeploymentLogs(result: DeploymentRunLogs, maxBytes: number): DeploymentRunLogs {
  const logs = typeof result?.logs === 'string' ? result.logs : '';
  const buffer = Buffer.from(logs, 'utf8');

  if (buffer.byteLength <= maxBytes) {
    return { logs, truncated: result?.truncated === true };
  }

  // Drop a partial leading UTF-8 sequence (continuation bytes) after slicing.
  let start = buffer.byteLength - maxBytes;

  while (start < buffer.byteLength && (buffer[start] & 0xc0) === 0x80) {
    start++;
  }

  return { logs: buffer.subarray(start).toString('utf8'), truncated: true };
}
