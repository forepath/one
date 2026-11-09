import {
  AGENT_GRAPH_LIMITS,
  type AgentGraphBuildStatus,
  type AgentGraphDocument,
  type AgentGraphWorkspaceSnapshotStatus,
} from '@forepath/agenstra/shared/util-opencode-config';
import { ClientAgentCredentialEntity } from '@forepath/identity/backend';
import { buildJobId, enqueueUnitJob, shouldRunApiHttp } from '@forepath/shared/backend/util-queue';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import {
  WORKSPACE_GRAPH_SNAPSHOT_UNIT_JOB_ID_NAMESPACE,
  WORKSPACE_GRAPH_SNAPSHOT_UNIT_JOB_NAME,
} from '../constants/workspace-graph-snapshot.constants';
import { AgentTaskEntity } from '../entities/agent-task.entity';
import { ChatPlanEntity } from '../entities/chat-plan.entity';
import { InitiativeArtifactEntity } from '../entities/initiative-artifact.entity';
import { InitiativeWorkItemDependencyEntity } from '../entities/initiative-work-item-dependency.entity';
import { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import { InitiativeEntity } from '../entities/initiative.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgeRelationEntity } from '../entities/knowledge-relation.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { WorkspaceGraphSnapshotEntity } from '../entities/workspace-graph-snapshot.entity';
import { AGENSTRA_CONTROLLER_QUEUE_NAME } from '../modules/agenstra-notifications.module';
import { ClientsRepository } from '../repositories/clients.repository';
import { WorkspaceGraphSnapshotsRepository } from '../repositories/workspace-graph-snapshots.repository';
import { effectiveWorkItemStatus, initiativeArtifactStatus } from '../utils/initiative-mappers';
import {
  buildWorkspaceSnapshotGraph,
  clampGraphInt,
  computeManagerKey,
  emptyGlobalGraphDocument,
  filterGraphByScopes,
  limitGraphByDegree,
  mapSettledWithConcurrency,
  truncateGraphError,
  unionWorkspaceGraphs,
  WORKSPACE_GRAPH_LIMITS,
  type GraphScopeCheck,
  type WorkspaceGraphEnvironmentInput,
} from '../utils/workspace-graph.utils';

import { ClientAgentGraphProxyService } from './client-agent-graph-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';
import { WorkspaceGraphChangeNotifierService } from './workspace-graph-change-notifier.service';

/** A failed build is retried lazily after this long (avoids rebuilding on every request). */
const FAILED_RETRY_MS = 60_000;

/**
 * Persisted per-workspace metadata graphs (environments with their digests, knowledge, tickets, plans) and the
 * global graph (union over the workspaces a caller may access). Builds are single-flight per workspace and bounded
 * in parallelism; a failed build keeps the previous graph.
 */
/** Set to `false` to skip rebuilding all workspace snapshots when the controller API starts. */
export const WORKSPACE_GRAPH_STARTUP_REBUILD_ENV = 'AGENT_GRAPH_SNAPSHOT_STARTUP_REBUILD';
/** Delay before the startup rebuild; gives agent-managers time to rebuild their environment graphs first. */
export const WORKSPACE_GRAPH_STARTUP_DELAY_MS_ENV = 'AGENT_GRAPH_SNAPSHOT_STARTUP_DELAY_MS';
const DEFAULT_STARTUP_DELAY_MS = 3 * 60_000;
/** Quiet period after a change signal before the snapshot is rebuilt (bursts of writes share one build). */
export const WORKSPACE_GRAPH_DIRTY_DEBOUNCE_MS = 10_000;
/** Manual refreshes within this window after a build (or while one runs) return the current status instead. */
export const WORKSPACE_GRAPH_MANUAL_REFRESH_COOLDOWN_MS = 30_000;
/** Continuous writes delay a change-driven rebuild by at most this long after the first change. */
export const WORKSPACE_GRAPH_DIRTY_MAX_WAIT_MS = 60_000;
/** At most one change-driven rebuild per workspace in this window. */
export const WORKSPACE_GRAPH_MIN_REBUILD_INTERVAL_MS = 30_000;

@Injectable()
export class WorkspaceGraphSnapshotService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceGraphSnapshotService.name);
  private readonly inflight = new Map<string, Promise<AgentGraphWorkspaceSnapshotStatus>>();
  private readonly buildQueue: (() => void)[] = [];
  private startupTimer?: NodeJS.Timeout;
  private readonly dirtyTimers = new Map<string, NodeJS.Timeout>();
  /** First unprocessed change per workspace (bounds the debounce). */
  private readonly dirtySince = new Map<string, number>();
  private unregisterChanges?: () => void;
  private runningBuilds = 0;

  constructor(
    private readonly snapshots: WorkspaceGraphSnapshotsRepository,
    private readonly clientsRepository: ClientsRepository,
    private readonly graphProxy: ClientAgentGraphProxyService,
    @InjectRepository(ClientAgentCredentialEntity)
    private readonly credentialsRepo: Repository<ClientAgentCredentialEntity>,
    @InjectRepository(KnowledgeNodeEntity)
    private readonly knowledgeRepo: Repository<KnowledgeNodeEntity>,
    @InjectRepository(KnowledgeRelationEntity)
    private readonly relationsRepo: Repository<KnowledgeRelationEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketsRepo: Repository<TicketEntity>,
    @InjectRepository(ChatPlanEntity)
    private readonly plansRepo: Repository<ChatPlanEntity>,
    @InjectRepository(AgentTaskEntity)
    private readonly tasksRepo: Repository<AgentTaskEntity>,
    @InjectRepository(InitiativeEntity)
    private readonly initiativesRepo: Repository<InitiativeEntity>,
    @InjectRepository(InitiativeArtifactEntity)
    private readonly initiativeArtifactsRepo: Repository<InitiativeArtifactEntity>,
    @InjectRepository(InitiativeWorkItemEntity)
    private readonly workItemsRepo: Repository<InitiativeWorkItemEntity>,
    @InjectRepository(InitiativeWorkItemDependencyEntity)
    private readonly workItemDependenciesRepo: Repository<InitiativeWorkItemDependencyEntity>,
    @Optional() private readonly agentProxy?: ClientAgentProxyService,
    @Optional() private readonly graphChanges?: WorkspaceGraphChangeNotifierService,
    @Optional() @InjectQueue(AGENSTRA_CONTROLLER_QUEUE_NAME) private readonly controllerQueue?: Queue,
  ) {}

  onModuleInit(): void {
    this.unregisterChanges = this.graphChanges?.register((clientId) => this.markDirty(clientId));
  }

  /** Agent ids that belong to the workspace (stored agent credentials), never taken from a request. */
  async listMemberAgentIds(clientId: string): Promise<string[]> {
    const rows = await this.credentialsRepo.find({
      where: { clientId },
      select: ['agentId'],
      order: { createdAt: 'ASC' },
    });

    return [...new Set(rows.map((row) => row.agentId.toLowerCase()))];
  }

  /** Environment display names of the workspace (empty when the manager is unreachable). */
  async resolveEnvironmentNames(clientId: string): Promise<Record<string, string>> {
    if (!this.agentProxy) {
      return {};
    }

    try {
      const agents = await this.agentProxy.getClientAgents(clientId, 1000, 0);

      return Object.fromEntries(
        agents.filter((agent) => agent.name).map((agent) => [agent.id.toLowerCase(), agent.name]),
      );
    } catch (error) {
      this.logger.debug(`Environment names of workspace ${clientId} unavailable: ${truncateGraphError(error)}`);

      return {};
    }
  }

  /**
   * Rebuild every workspace snapshot once after startup (and after upgrades), so the global graph is available right
   * away; afterwards change signals ({@link markDirty}) keep them current, with the stale window and manual refreshes
   * as fallbacks. API processes only (worker /
   * scheduler processes of the same deployment would duplicate the work).
   */
  onApplicationBootstrap(): void {
    if (
      !shouldRunApiHttp() ||
      (process.env[WORKSPACE_GRAPH_STARTUP_REBUILD_ENV] ?? '').trim().toLowerCase() === 'false'
    ) {
      return;
    }

    const configured = Number(process.env[WORKSPACE_GRAPH_STARTUP_DELAY_MS_ENV]);
    const delay = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_STARTUP_DELAY_MS;

    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      void this.rebuildAll().catch((error: unknown) => {
        this.logger.warn(`Startup rebuild of workspace graph snapshots failed: ${String(error)}`);
      });
    }, delay);
    this.startupTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.unregisterChanges?.();
    this.unregisterChanges = undefined;

    for (const timer of this.dirtyTimers.values()) {
      clearTimeout(timer);
    }

    this.dirtyTimers.clear();
    this.dirtySince.clear();

    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }
  }

  /**
   * Change signal (knowledge, tickets, plans, environments of the workspace): rebuild after a quiet period, at most
   * once per {@link WORKSPACE_GRAPH_MIN_REBUILD_INTERVAL_MS}. Only workspaces that have a snapshot already; others are
   * built when first viewed. A build running at that time is awaited first, so its result never hides the change.
   */
  markDirty(clientId: string): void {
    void (async () => {
      const [row] = await this.snapshots.findStatusesByClientIds([clientId]);

      if (!row?.builtAt) {
        return;
      }

      const builtAt = new Date(row.builtAt).getTime();

      // With the controller queue the rebuild is a delayed BullMQ job (one per workspace across all controller
      // processes, survives restarts, runs in the worker role); without one (tests, queue-less setups) a local timer.
      if (this.controllerQueue) {
        await this.scheduleDirtyJob(this.controllerQueue, clientId, builtAt);

        return;
      }

      const existing = this.dirtyTimers.get(clientId);

      if (existing) {
        clearTimeout(existing);
      }

      const now = Date.now();
      const since = this.dirtySince.get(clientId) ?? now;
      const delay = this.dirtyDelay(now, since, builtAt);

      this.dirtySince.set(clientId, since);

      const timer = setTimeout(() => {
        this.dirtyTimers.delete(clientId);
        this.dirtySince.delete(clientId);
        void this.runDirtyRebuild(clientId);
      }, delay);

      timer.unref?.();
      this.dirtyTimers.set(clientId, timer);
    })().catch((error: unknown) => {
      this.logger.debug(`Graph snapshot dirty mark for workspace ${clientId} failed: ${String(error)}`);
    });
  }

  /**
   * Change-driven rebuild (the delayed job's work, or the local timer's): a build running at that time is awaited
   * first, so its result never hides the change. Failures are logged, not retried (the next change, the stale window
   * or a manual refresh rebuild again).
   */
  async runDirtyRebuild(clientId: string): Promise<void> {
    try {
      await this.inflight.get(clientId)?.catch(() => undefined);
      await this.build(clientId);
    } catch (error) {
      this.logger.warn(
        `Change-driven graph snapshot build of workspace ${clientId} failed: ${truncateGraphError(error)}`,
      );
    }
  }

  /** Quiet period after the latest change, the minimum interval after the last build, capped by the maximum wait. */
  private dirtyDelay(now: number, since: number, builtAt: number): number {
    const wanted = Math.max(
      WORKSPACE_GRAPH_DIRTY_DEBOUNCE_MS,
      WORKSPACE_GRAPH_MIN_REBUILD_INTERVAL_MS - (now - builtAt),
    );

    return Math.max(0, Math.min(wanted, since + WORKSPACE_GRAPH_DIRTY_MAX_WAIT_MS - now));
  }

  /**
   * Debounce on the queue: a delayed job of the workspace is pushed back (its first-change time travels in the job
   * data, so the maximum wait holds across processes); a waiting one is about to read the latest state anyway; while
   * one runs, the change goes into a follow-up job.
   */
  private async scheduleDirtyJob(queue: Queue, clientId: string, builtAt: number): Promise<void> {
    for (const followUp of [undefined, 'next'] as const) {
      const jobId = buildJobId(WORKSPACE_GRAPH_SNAPSHOT_UNIT_JOB_ID_NAMESPACE, clientId, followUp);
      const existing = await queue.getJob(jobId);
      const state = existing ? await existing.getState() : undefined;
      const now = Date.now();

      if (state === 'active') {
        continue;
      }

      if (existing && state === 'delayed') {
        const since = Number((existing.data as { since?: unknown } | undefined)?.since) || now;

        await existing.changeDelay(this.dirtyDelay(now, since, builtAt));

        return;
      }

      if (state === 'waiting' || state === 'prioritized' || state === 'waiting-children') {
        return;
      }

      await enqueueUnitJob({
        queue,
        jobName: WORKSPACE_GRAPH_SNAPSHOT_UNIT_JOB_NAME,
        payload: { clientId, since: now },
        jobIdNamespace: WORKSPACE_GRAPH_SNAPSHOT_UNIT_JOB_ID_NAMESPACE,
        jobIdParts: [clientId, followUp],
        opts: { delay: this.dirtyDelay(now, now, builtAt), attempts: 1 },
      });

      return;
    }
  }

  /** Rebuild the snapshots of all workspaces (bounded by the build concurrency). */
  async rebuildAll(): Promise<{ built: number; failed: number }> {
    const clientIds = await this.clientsRepository.findAllIds();
    const results = await Promise.allSettled(clientIds.map((clientId) => this.build(clientId)));
    const failed = results.filter((result) => result.status === 'rejected' || result.value.status === 'failed').length;

    this.logger.log(`Workspace graph snapshots rebuilt: ${clientIds.length - failed} ok, ${failed} failed`);

    return { built: clientIds.length - failed, failed };
  }

  /**
   * Manual refresh: joins a running build and skips snapshots built within
   * {@link WORKSPACE_GRAPH_MANUAL_REFRESH_COOLDOWN_MS}, so repeated requests cannot keep the shared build slots busy.
   */
  async refresh(clientId: string): Promise<AgentGraphWorkspaceSnapshotStatus> {
    const running = this.inflight.get(clientId);

    if (running) {
      return await running;
    }

    const [status] = await this.getStatuses([clientId]);
    const builtAt = status?.builtAt ? new Date(status.builtAt).getTime() : 0;

    if (status?.status === 'ready' && Date.now() - builtAt < WORKSPACE_GRAPH_MANUAL_REFRESH_COOLDOWN_MS) {
      return status;
    }

    return await this.build(clientId);
  }

  /** Rebuild the workspace snapshot now (joins a build already running for the workspace). */
  async build(clientId: string): Promise<AgentGraphWorkspaceSnapshotStatus> {
    const running = this.inflight.get(clientId);

    if (running) {
      return await running;
    }

    const promise = this.withBuildSlot(() => this.runBuild(clientId)).finally(() => this.inflight.delete(clientId));

    this.inflight.set(clientId, promise);

    return await promise;
  }

  /**
   * The workspace's snapshot graph: built (and awaited) when none exists, refreshed in the background when stale.
   * Returns `undefined` when no graph could be built.
   */
  async getOrBuild(clientId: string): Promise<AgentGraphDocument | undefined> {
    let snapshot = await this.snapshots.findByClientId(clientId);

    if (!snapshot?.graph) {
      // No graph yet: wait for a build (joins one already running on this instance).
      if (this.inflight.has(clientId) || this.shouldRebuild(snapshot)) {
        await this.build(clientId);
        snapshot = await this.snapshots.findByClientId(clientId);
      }
    } else if (this.shouldRebuild(snapshot)) {
      this.scheduleBuild(clientId);
    }

    return snapshot?.graph ?? undefined;
  }

  /** Snapshot of one workspace, filtered by the caller's scopes. */
  async getWorkspaceDocument(clientId: string, isAllowed: GraphScopeCheck): Promise<AgentGraphDocument> {
    const graph = await this.getOrBuild(clientId);

    if (!graph) {
      return emptyGlobalGraphDocument(clientId);
    }

    return { ...filterGraphByScopes(graph, isAllowed), scope: 'global', layer: 'global', clientId };
  }

  /**
   * Union of the snapshots of `clientIds` (resolved by the caller from its own access rules), filtered by scopes and
   * cut to `limit` nodes by degree. Missing or stale snapshots are refreshed in the background.
   */
  async getGlobalDocument(
    clientIds: readonly string[],
    options: { limit?: unknown; isAllowed: GraphScopeCheck },
  ): Promise<AgentGraphDocument> {
    const ids = [...new Set(clientIds)];
    const snapshots = await this.snapshots.findByClientIds(ids);
    const byClient = new Map(snapshots.map((snapshot) => [snapshot.clientId, snapshot]));

    for (const clientId of ids) {
      const snapshot = byClient.get(clientId) ?? null;

      if (this.shouldRebuild(snapshot)) {
        this.scheduleBuild(clientId);
      }
    }

    const documents = snapshots
      .filter((snapshot) => !!snapshot.graph)
      .map((snapshot) => filterGraphByScopes(snapshot.graph as AgentGraphDocument, options.isAllowed));
    const union = unionWorkspaceGraphs(documents);
    const limit =
      clampGraphInt(options.limit, 1, AGENT_GRAPH_LIMITS.maxDocumentNodes) ?? AGENT_GRAPH_LIMITS.defaultDocumentNodes;
    const limited = limitGraphByDegree(union.nodes, union.edges, limit);

    return {
      version: 1,
      scope: 'global',
      layer: 'global',
      generatedAt: new Date().toISOString(),
      nodes: limited.nodes,
      edges: limited.edges,
      truncated: limited.truncated,
      totalNodes: union.nodes.length,
      totalEdges: union.edges.length,
    };
  }

  /** Snapshot statuses of `clientIds` (`missing` for workspaces without a snapshot). */
  async getStatuses(clientIds: readonly string[]): Promise<AgentGraphWorkspaceSnapshotStatus[]> {
    const ids = [...new Set(clientIds)];
    const rows = await this.snapshots.findStatusesByClientIds(ids);
    const byClient = new Map(rows.map((row) => [row.clientId, row]));

    return ids.map((clientId): AgentGraphWorkspaceSnapshotStatus => {
      const row = byClient.get(clientId);
      const status = row ? this.toStatus(row) : this.missingStatus(clientId);

      return this.inflight.has(clientId) ? { ...status, status: 'building' } : status;
    });
  }

  private shouldRebuild(snapshot: WorkspaceGraphSnapshotEntity | null | undefined, now = Date.now()): boolean {
    if (!snapshot) {
      return true;
    }

    if (this.inflight.has(snapshot.clientId)) {
      return false;
    }

    const updatedAt = snapshot.updatedAt ? new Date(snapshot.updatedAt).getTime() : 0;

    // Another instance is building (or a crashed build left the marker; it expires with the stale window).
    if (snapshot.status === 'building' && now - updatedAt < WORKSPACE_GRAPH_LIMITS.staleAfterMs) {
      return false;
    }

    if (snapshot.status === 'failed' && now - updatedAt < FAILED_RETRY_MS) {
      return false;
    }

    if (!snapshot.builtAt || !snapshot.graph) {
      return true;
    }

    return now - new Date(snapshot.builtAt).getTime() > WORKSPACE_GRAPH_LIMITS.staleAfterMs;
  }

  private scheduleBuild(clientId: string): void {
    void this.build(clientId).catch((error) =>
      this.logger.warn(`Background graph snapshot build of workspace ${clientId} failed: ${truncateGraphError(error)}`),
    );
  }

  /** Run `fn` once a build slot is free (bounded parallel builds across workspaces). */
  private async withBuildSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.runningBuilds >= WORKSPACE_GRAPH_LIMITS.buildConcurrency) {
      await new Promise<void>((resolve) => this.buildQueue.push(resolve));
    }

    this.runningBuilds++;

    try {
      return await fn();
    } finally {
      this.runningBuilds--;
      this.buildQueue.shift()?.();
    }
  }

  private async runBuild(clientId: string): Promise<AgentGraphWorkspaceSnapshotStatus> {
    const startedAt = Date.now();

    try {
      const client = await this.clientsRepository.findById(clientId);

      if (!client) {
        throw new NotFoundException(`Client ${clientId} not found`);
      }

      await this.snapshots.upsert(clientId, { status: 'building' });

      const managerKey = computeManagerKey(client.endpoint);
      const agentIds = await this.listMemberAgentIds(clientId);
      const [names, digests, knowledge, tickets, plans, relations, tasks, initiatives] = await Promise.all([
        agentIds.length > 0 ? this.resolveEnvironmentNames(clientId) : Promise.resolve({} as Record<string, string>),
        mapSettledWithConcurrency(agentIds, WORKSPACE_GRAPH_LIMITS.digestConcurrency, (agentId) =>
          this.graphProxy.getDigest(clientId, agentId),
        ),
        this.knowledgeRepo.find({
          where: { clientId },
          select: ['id', 'nodeType', 'parentId', 'title', 'longSha'],
          order: { sortOrder: 'ASC', createdAt: 'ASC' },
          take: WORKSPACE_GRAPH_LIMITS.maxKnowledgeNodes,
        }),
        this.ticketsRepo.find({
          where: { clientId },
          select: ['id', 'parentId', 'title', 'longSha', 'status', 'priority'],
          order: { updatedAt: 'DESC' },
          take: WORKSPACE_GRAPH_LIMITS.maxTickets,
        }),
        agentIds.length > 0
          ? this.plansRepo.find({
              where: { clientId, agentId: In(agentIds) },
              select: ['id', 'agentId', 'summary', 'longSha', 'status'],
              order: { startedAt: 'DESC' },
              take: WORKSPACE_GRAPH_LIMITS.maxPlans,
            })
          : Promise.resolve([] as ChatPlanEntity[]),
        this.relationsRepo.find({
          where: { clientId },
          select: ['sourceType', 'sourceId', 'targetType', 'targetNodeId', 'targetTicketLongSha'],
          take: WORKSPACE_GRAPH_LIMITS.maxKnowledgeRelations,
        }),
        agentIds.length > 0
          ? this.tasksRepo.find({
              where: { clientId, agentId: In(agentIds) },
              select: ['id', 'agentId', 'title', 'cronExpression', 'enabled'],
              order: { createdAt: 'ASC' },
              take: WORKSPACE_GRAPH_LIMITS.maxTasks,
            })
          : Promise.resolve([] as AgentTaskEntity[]),
        this.initiativesRepo.find({
          where: { clientId },
          select: ['id', 'title', 'longSha', 'path', 'phase', 'state'],
          order: { updatedAt: 'DESC' },
          take: WORKSPACE_GRAPH_LIMITS.maxInitiatives,
        }),
      ]);
      const initiativeIds = initiatives.map((initiative) => initiative.id);
      const [initiativeArtifacts, workItems, workItemDependencies] =
        initiativeIds.length > 0
          ? await Promise.all([
              this.initiativeArtifactsRepo.find({
                where: { clientId, initiativeId: In(initiativeIds) },
                select: [
                  'id',
                  'initiativeId',
                  'workItemId',
                  'type',
                  'title',
                  'longSha',
                  'currentVersion',
                  'acceptedVersion',
                ],
                order: { createdAt: 'ASC' },
                take: WORKSPACE_GRAPH_LIMITS.maxInitiativeArtifacts,
              }),
              this.workItemsRepo.find({
                where: { clientId, initiativeId: In(initiativeIds) },
                select: ['id', 'initiativeId', 'parentId', 'kind', 'key', 'title', 'status', 'ticketId'],
                order: { sortOrder: 'ASC' },
                take: WORKSPACE_GRAPH_LIMITS.maxWorkItems,
              }),
              this.workItemDependenciesRepo.find({
                where: { initiativeId: In(initiativeIds) },
                select: ['workItemId', 'prerequisiteId'],
                take: WORKSPACE_GRAPH_LIMITS.maxWorkItemDependencies,
              }),
            ])
          : [[], [], []];
      // Transferred items show their ticket's progress, like the Initiatives page (derived, not stored).
      const ticketStatusById = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
      const environments: WorkspaceGraphEnvironmentInput[] = agentIds.map((agentId, index) => {
        const result = digests[index];

        if (result.status === 'fulfilled') {
          return { agentId, name: names[agentId], managerKey, digest: result.value };
        }

        const failedStatus: AgentGraphBuildStatus = result.reason instanceof NotFoundException ? 'missing' : 'failed';
        const reason = truncateGraphError(result.reason);

        this.logger.debug(`Graph digest of environment ${agentId} (workspace ${clientId}) unavailable: ${reason}`);

        return { agentId, name: names[agentId], managerKey, failedStatus };
      });
      const graph = buildWorkspaceSnapshotGraph({
        clientId,
        clientName: client.name,
        environments,
        knowledge,
        tickets,
        plans,
        relations,
        tasks,
        initiatives,
        initiativeArtifacts: initiativeArtifacts.map((artifact) => ({
          ...artifact,
          status: initiativeArtifactStatus(artifact),
        })),
        workItems: workItems.map((item) => ({
          ...item,
          status: effectiveWorkItemStatus(item, item.ticketId ? ticketStatusById.get(item.ticketId) : undefined),
        })),
        workItemDependencies,
      });
      const saved = await this.snapshots.upsert(clientId, {
        status: 'ready',
        graph,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        builtAt: new Date(),
        error: null,
      });

      this.logger.debug(
        `Graph snapshot of workspace ${clientId} built in ${Date.now() - startedAt}ms (${graph.nodes.length} nodes)`,
      );

      return this.toStatus(saved);
    } catch (error) {
      const message = truncateGraphError(error);

      this.logger.warn(`Graph snapshot build of workspace ${clientId} failed: ${message}`);

      if (error instanceof NotFoundException) {
        return { ...this.missingStatus(clientId), status: 'failed', error: message };
      }

      // The previous graph stays available; only status and error change.
      const saved = await this.snapshots.upsert(clientId, { status: 'failed', error: message }).catch(() => undefined);

      return saved ? this.toStatus(saved) : { ...this.missingStatus(clientId), status: 'failed', error: message };
    }
  }

  private toStatus(row: WorkspaceGraphSnapshotEntity): AgentGraphWorkspaceSnapshotStatus {
    return {
      clientId: row.clientId,
      status: row.status,
      builtAt: row.builtAt ? new Date(row.builtAt).toISOString() : null,
      error: row.error ?? null,
      nodes: row.nodeCount ?? 0,
      edges: row.edgeCount ?? 0,
    };
  }

  private missingStatus(clientId: string): AgentGraphWorkspaceSnapshotStatus {
    return { clientId, status: 'missing', builtAt: null, error: null, nodes: 0, edges: 0 };
  }
}
