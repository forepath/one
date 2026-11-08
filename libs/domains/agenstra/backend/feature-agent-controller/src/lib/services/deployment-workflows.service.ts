import {
  DEPLOYMENT_LIMITS,
  type AgentDeploymentWorkflowInput,
  type AgentDeploymentWorkflowUpdateInput,
  type DeploymentBranchSummary,
  type DeploymentConnectionOption,
  type DeploymentProviderWorkflowSummary,
  type DeploymentRepositorySummary,
  type DeploymentWorkflowActorType,
  type DeploymentWorkflowScope,
  type DeploymentWorkflowSummary,
  type DeploymentWorkflowApprovalStatus,
} from '@forepath/agenstra/shared/util-opencode-config';
import { ClientAgentCredentialsRepository } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import {
  DEPLOYMENT_WORKFLOWS_DEFAULT_LIMIT,
  DEPLOYMENT_WORKFLOWS_MAX_LIMIT,
  type CreateDeploymentWorkflowDto,
  type UpdateDeploymentWorkflowDto,
} from '../dto/deployments';
import type { DeploymentConnectionEntity } from '../entities/deployment-connection.entity';
import { DeploymentRunEntity } from '../entities/deployment-run.entity';
import { DeploymentWorkflowEntity } from '../entities/deployment-workflow.entity';
import { StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { mapDeploymentWorkflowToSearchDocument } from '../search/agenstra-search-document.mapper';
import { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';
import {
  applyAgenstraSearchIlike,
  sanitizeListSearch,
  tryAgenstraSearchIds,
} from '../search/agenstra-search-list.util';
import { normalizeDeploymentInputs } from '../utils/deployment-inputs.utils';

import { DeploymentConnectionsService } from './deployment-connections.service';
import { DeploymentRealtimeService } from './deployment-realtime.service';
import { StatisticsService } from './statistics.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Upper bound of OpenSearch ids considered for one workflow list search (workspaces have few workflows). */
const WORKFLOW_SEARCH_ID_LIMIT = 1_000;

/** Workflows one environment may have proposed (created) in its workspace; bounds what an agent can create. */
export const DEPLOYMENT_AGENT_WORKFLOWS_MAX = 25;

/** Answer to anyone starting runs of a pending workflow. */
export const DEPLOYMENT_WORKFLOW_PENDING_MESSAGE =
  'This deployment workflow waits for approval by a workspace admin (console, Pipelines page) before runs can be ' +
  'started.';

/**
 * Approved content: what runs do and who may start them. An environment changing any of it makes its workflow pending
 * again (assignment fields cannot be changed by environments at all).
 */
type WorkflowContentField =
  | 'connectionId'
  | 'name'
  | 'description'
  | 'repository'
  | 'workflow'
  | 'defaultRef'
  | 'defaultInputs'
  | 'agentTriggerEnabled';

/**
 * Fields of the console workflow editor. A user PUT approves only when it carries every one of them (the complete
 * content the user saw and wrote: the editor always submits the full form, `null` counting as submitted); partial
 * updates such as the enable switch never approve content the user did not submit.
 */
export const DEPLOYMENT_WORKFLOW_COMPLETE_CONTENT_FIELDS = [
  'connectionId',
  'name',
  'description',
  'repository',
  'workflow',
  'defaultRef',
  'defaultInputs',
  'scope',
  'agentIds',
  'agentTriggerEnabled',
] as const satisfies readonly (keyof UpdateDeploymentWorkflowDto)[];

type WorkflowActor = { type: 'user'; userId: string | null } | { type: 'agent'; agentId: string };

type ConnectionLookup = (connectionId: string) => Promise<DeploymentConnectionEntity>;

export interface DeploymentWorkflowListQuery {
  /** Only workflows available to this environment (global + assigned). */
  agentId?: string;
  /** `pending`: waiting for a workspace admin; `approved`: runs can be started. */
  approvalStatus?: DeploymentWorkflowApprovalStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Deployment workflows of a workspace (on top of an admin managed deployment connection). Access checks happen in
 * {@link ClientDeploymentsController} (read: workspace members; write: workspace management); every lookup here is
 * scoped by `clientId`, so ids of other workspaces are indistinguishable from missing ones.
 *
 * Approval: workflows written by workspace users are approved. Environments (MCP, `*ForAgent`) may propose workflows
 * for themselves (always `scope: environments` with only their own id) and manage the workflows assigned exclusively
 * to them; such a workflow is pending (`approvedAt` null) after an environment created it, changed its content or
 * switched it on again, until a workspace admin approves it (`approve`, or saving the complete editor form). Nobody can
 * start runs of a pending workflow, and environments only see their own pending workflows.
 *
 * Environments use (runs) only enabled, approved workflows that are global or assigned to them.
 */
@Injectable()
export class DeploymentWorkflowsService {
  private readonly logger = new Logger(DeploymentWorkflowsService.name);

  constructor(
    @InjectRepository(DeploymentWorkflowEntity)
    private readonly workflowRepo: Repository<DeploymentWorkflowEntity>,
    @InjectRepository(DeploymentRunEntity)
    private readonly runRepo: Repository<DeploymentRunEntity>,
    private readonly connections: DeploymentConnectionsService,
    private readonly clientAgentCredentialsRepository: ClientAgentCredentialsRepository,
    private readonly realtime: DeploymentRealtimeService,
    private readonly statisticsService: StatisticsService,
    @Optional() private readonly searchIndex?: AgenstraSearchIndexService,
    @Optional() private readonly notificationPublisher?: AgenstraNotificationPublisher,
  ) {}

  // --- workspace users -------------------------------------------------------------------------------------

  async list(clientId: string, query: DeploymentWorkflowListQuery = {}): Promise<DeploymentWorkflowSummary[]> {
    const limit = this.boundLimit(query.limit, DEPLOYMENT_WORKFLOWS_DEFAULT_LIMIT, DEPLOYMENT_WORKFLOWS_MAX_LIMIT);
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const qb = this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.connection', 'c')
      .where('w.client_id = :clientId', { clientId });

    if (query.agentId) {
      this.whereAvailableToAgent(qb, query.agentId);
    }

    if (query.approvalStatus === 'pending') {
      qb.andWhere('w.approved_at IS NULL');
    } else if (query.approvalStatus === 'approved') {
      qb.andWhere('w.approved_at IS NOT NULL');
    }

    const search = sanitizeListSearch(query.search);

    if (search) {
      const lookup = await tryAgenstraSearchIds(
        this.searchIndex,
        { entityType: 'deployment-workflows', query: search, clientIds: [clientId], limit: WORKFLOW_SEARCH_ID_LIMIT },
        this.logger,
      );

      if (lookup && lookup.ids.length > 0) {
        qb.andWhere('w.id IN (:...searchIds)', { searchIds: lookup.ids });
      } else {
        applyAgenstraSearchIlike(qb, 'deployment-workflows', 'w', search);
      }
    }

    const rows = await qb.orderBy('w.name', 'ASC').addOrderBy('w.id', 'ASC').skip(offset).take(limit).getMany();

    return rows.map((row) => this.toSummary(row));
  }

  async get(clientId: string, workflowId: string): Promise<DeploymentWorkflowSummary> {
    return this.toSummary(await this.findOrThrow(clientId, workflowId));
  }

  async create(
    clientId: string,
    dto: CreateDeploymentWorkflowDto,
    userId?: string | null,
  ): Promise<DeploymentWorkflowSummary> {
    const connection = await this.connections.findUsableOrThrow(clientId, dto.connectionId);
    const scope = this.requireScope(dto.scope ?? 'global');
    const agentIds = await this.requireAgentIds(clientId, scope, dto.agentIds);
    const workflow = this.optionalText(dto.workflow, 'workflow', DEPLOYMENT_LIMITS.workflowMaxLength);

    this.assertProviderWorkflow(connection, workflow);

    const saved = await this.workflowRepo.save(
      this.workflowRepo.create({
        clientId,
        connectionId: connection.id,
        name: this.requireText(dto.name, 'name', DEPLOYMENT_LIMITS.nameMaxLength),
        description: this.optionalText(dto.description, 'description', DEPLOYMENT_LIMITS.descriptionMaxLength),
        repository: this.requireText(dto.repository, 'repository', DEPLOYMENT_LIMITS.repositoryMaxLength),
        workflow,
        defaultRef: this.optionalText(dto.defaultRef, 'defaultRef', DEPLOYMENT_LIMITS.refMaxLength),
        defaultInputs: normalizeDeploymentInputs(dto.defaultInputs, 'defaultInputs'),
        scope,
        agentIds,
        agentTriggerEnabled: dto.agentTriggerEnabled === true,
        enabled: dto.enabled !== false,
        createdByUserId: userId ?? null,
        // A workspace admin writing the workflow approves it.
        approvedAt: new Date(),
        approvedByUserId: userId ?? null,
        createdByType: 'user',
        updatedByType: 'user',
        createdByAgentId: null,
      }),
    );
    const entity = await this.findOrThrow(clientId, saved.id);
    const summary = this.toSummary(entity);

    this.publishChange(entity, summary, 'deployment_workflow.created');
    this.statisticsService
      .recordEntityCreated(StatisticsEntityType.DEPLOYMENT_WORKFLOW, entity.id, { clientId }, userId ?? undefined)
      .catch(() => undefined);

    return summary;
  }

  /**
   * Partial update (omitted fields stay unchanged) under a row lock, so an environment change and a user's approving
   * save never interleave. Approves when the complete editor content is submitted
   * ({@link DEPLOYMENT_WORKFLOW_COMPLETE_CONTENT_FIELDS}).
   */
  async update(
    clientId: string,
    workflowId: string,
    dto: UpdateDeploymentWorkflowDto,
    userId?: string | null,
  ): Promise<DeploymentWorkflowSummary> {
    const approvedNow = await this.workflowRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(DeploymentWorkflowEntity);
      const entity = await this.lockOrThrow(repo, clientId, workflowId);
      const wasApproved = Boolean(entity.approvedAt);

      await this.applyContent(entity, dto, (connectionId) =>
        this.connections.findUsableOrThrow(clientId, connectionId),
      );

      if (dto.scope !== undefined || dto.agentIds !== undefined) {
        entity.scope = this.requireScope(dto.scope ?? entity.scope);
        entity.agentIds = await this.requireAgentIds(clientId, entity.scope, dto.agentIds ?? entity.agentIds);
      }

      if (dto.enabled !== undefined) {
        entity.enabled = dto.enabled;
      }

      const complete = DEPLOYMENT_WORKFLOW_COMPLETE_CONTENT_FIELDS.every((field) => dto[field] !== undefined);

      if (complete) {
        entity.approvedAt = new Date();
        entity.approvedByUserId = userId ?? null;
      }

      entity.updatedByType = 'user';
      await repo.save(entity);

      return complete && !wasApproved;
    });

    const saved = await this.findOrThrow(clientId, workflowId);
    const summary = this.toSummary(saved);

    this.publishChange(saved, summary, 'deployment_workflow.updated');
    this.statisticsService
      .recordEntityUpdated(
        StatisticsEntityType.DEPLOYMENT_WORKFLOW,
        saved.id,
        approvedNow ? { clientId, action: 'approved' } : { clientId },
        userId ?? undefined,
      )
      .catch(() => undefined);

    return summary;
  }

  /**
   * Approve the content of a pending workflow (workspace management). `reviewedUpdatedAt` is the version the admin
   * looked at: a workflow changed in between (e.g. by its environment) is not approved (409). Approving an approved
   * workflow is a no-op.
   */
  async approve(
    clientId: string,
    workflowId: string,
    reviewedUpdatedAt: string,
    userId?: string | null,
  ): Promise<DeploymentWorkflowSummary> {
    const reviewed = new Date(reviewedUpdatedAt);

    if (Number.isNaN(reviewed.getTime())) {
      throw new BadRequestException('updatedAt must be the ISO timestamp of the reviewed workflow');
    }

    const approvedNow = await this.workflowRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(DeploymentWorkflowEntity);
      const entity = await this.lockOrThrow(repo, clientId, workflowId);

      // Under the row lock: nothing can change the workflow between this check and the update.
      if (entity.updatedAt.getTime() !== reviewed.getTime()) {
        throw new ConflictException('The workflow changed since you reviewed it; review it again before approving.');
      }

      if (entity.approvedAt) {
        return false;
      }

      await repo.update({ id: entity.id, clientId }, { approvedAt: new Date(), approvedByUserId: userId ?? null });

      return true;
    });

    const saved = await this.findOrThrow(clientId, workflowId);
    const summary = this.toSummary(saved);

    if (approvedNow) {
      this.publishChange(saved, summary, 'deployment_workflow.updated');
      this.statisticsService
        .recordEntityUpdated(
          StatisticsEntityType.DEPLOYMENT_WORKFLOW,
          saved.id,
          { clientId, action: 'approved' },
          userId ?? undefined,
        )
        .catch(() => undefined);
    }

    return summary;
  }

  /** Deletes the workflow and (cascade) its run history. */
  async remove(clientId: string, workflowId: string, userId?: string | null): Promise<void> {
    await this.removeEntity(await this.findOrThrow(clientId, workflowId), { type: 'user', userId: userId ?? null });
  }

  // --- connection browsing (workflow editor) -----------------------------------------------------------------

  async listConnectionOptions(clientId: string): Promise<DeploymentConnectionOption[]> {
    return await this.connections.listOptionsForClient(clientId);
  }

  async listRepositories(
    clientId: string,
    connectionId: string,
    search?: string,
  ): Promise<DeploymentRepositorySummary[]> {
    const { provider, connection } = await this.providerForConnection(clientId, connectionId);

    return await provider.listRepositories(connection, sanitizeListSearch(search));
  }

  async listBranches(clientId: string, connectionId: string, repository: string): Promise<DeploymentBranchSummary[]> {
    const { provider, connection } = await this.providerForConnection(clientId, connectionId);

    return await provider.listBranches(
      connection,
      this.requireText(repository, 'repository', DEPLOYMENT_LIMITS.repositoryMaxLength),
    );
  }

  async listProviderWorkflows(
    clientId: string,
    connectionId: string,
    repository: string,
  ): Promise<DeploymentProviderWorkflowSummary[]> {
    const { provider, connection } = await this.providerForConnection(clientId, connectionId);

    return await provider.listWorkflows(
      connection,
      this.requireText(repository, 'repository', DEPLOYMENT_LIMITS.repositoryMaxLength),
    );
  }

  // --- environments (manager socket) -------------------------------------------------------------------------

  /**
   * Enabled, approved workflows that are global or assigned to the environment, plus the workflows assigned
   * exclusively to it in any state (its own pending or disabled ones, so it can manage them). Pending workflows of
   * other environments are never included.
   */
  async listForAgent(clientId: string, agentId: string): Promise<DeploymentWorkflowSummary[]> {
    const qb = this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.connection', 'c')
      .where('w.client_id = :clientId', { clientId })
      .andWhere(
        "((w.enabled = true AND w.approved_at IS NOT NULL AND (w.scope = 'global' OR w.agent_ids @> CAST(:agentIdsJson AS jsonb))) " +
          "OR (w.scope = 'environments' AND w.agent_ids = CAST(:agentIdsJson AS jsonb)))",
        { agentIdsJson: JSON.stringify([agentId.toLowerCase()]) },
      );

    return (await qb.orderBy('w.name', 'ASC').addOrderBy('w.id', 'ASC').getMany()).map((row) => this.toSummary(row));
  }

  /** Workflows whose runs the environment may read / start: enabled, approved, global or assigned to it. */
  async findAvailableForAgent(clientId: string, agentId: string): Promise<DeploymentWorkflowEntity[]> {
    const qb = this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.connection', 'c')
      .where('w.client_id = :clientId', { clientId })
      .andWhere('w.enabled = true')
      .andWhere('w.approved_at IS NOT NULL');

    this.whereAvailableToAgent(qb, agentId);

    return await qb.orderBy('w.name', 'ASC').addOrderBy('w.id', 'ASC').getMany();
  }

  /**
   * Enabled, approved workflow available to the environment. Workflows it may not use are indistinguishable from
   * missing ones; only for its own (exclusively assigned) workflows it learns why (pending / disabled, 409).
   */
  async findForAgentOrThrow(clientId: string, agentId: string, workflowId: string): Promise<DeploymentWorkflowEntity> {
    const workflow = UUID_V4.test(workflowId)
      ? await this.workflowRepo.findOne({ where: { id: workflowId, clientId }, relations: { connection: true } })
      : null;

    if (!workflow || !DeploymentWorkflowsService.isAvailableToAgent(workflow, agentId)) {
      throw new NotFoundException('Deployment workflow not found');
    }

    if (!workflow.approvedAt || !workflow.enabled) {
      if (DeploymentWorkflowsService.isExclusivelyAssigned(workflow, agentId)) {
        throw new ConflictException(
          workflow.approvedAt ? 'Deployment workflow is disabled' : DEPLOYMENT_WORKFLOW_PENDING_MESSAGE,
        );
      }

      throw new NotFoundException('Deployment workflow not found');
    }

    return workflow;
  }

  /**
   * One workflow as the environment sees it in `listForAgent`: usable by it (enabled, approved, global or assigned),
   * or its own exclusively assigned workflow in any state (pending / disabled). Everything else is not found.
   */
  async getForAgent(clientId: string, agentId: string, workflowId: string): Promise<DeploymentWorkflowSummary> {
    const workflow = UUID_V4.test(workflowId)
      ? await this.workflowRepo.findOne({ where: { id: workflowId, clientId }, relations: { connection: true } })
      : null;

    if (
      !workflow ||
      !(
        DeploymentWorkflowsService.isUsableByAgent(workflow, agentId) ||
        DeploymentWorkflowsService.isExclusivelyAssigned(workflow, agentId)
      )
    ) {
      throw new NotFoundException('Deployment workflow not found');
    }

    return this.toSummary(workflow);
  }

  /** Summary of a workflow the environment may use (chat approval prompt of the manager). */
  async describeForAgent(clientId: string, agentId: string, workflowId: string): Promise<DeploymentWorkflowSummary> {
    return this.toSummary(await this.findForAgentOrThrow(clientId, agentId, workflowId));
  }

  /**
   * Workflow an environment proposes for itself: assigned to that environment only (forced), pending until a
   * workspace admin approves it, same validation as the console editor. The connection has to be usable by the
   * workspace; other connections are indistinguishable from missing ones.
   */
  async createForAgent(
    clientId: string,
    agentId: string,
    input: AgentDeploymentWorkflowInput,
  ): Promise<DeploymentWorkflowSummary> {
    const id = agentId.toLowerCase();

    if (
      (await this.workflowRepo.count({ where: { clientId, createdByAgentId: id } })) >= DEPLOYMENT_AGENT_WORKFLOWS_MAX
    ) {
      throw new ConflictException(
        `An environment can propose at most ${DEPLOYMENT_AGENT_WORKFLOWS_MAX} deployment workflows; delete unused ones first.`,
      );
    }

    if (typeof input?.connectionId !== 'string' || !input.connectionId) {
      throw new BadRequestException('connectionId is required');
    }

    const connection = await this.findConnectionForAgent(clientId, input.connectionId);
    const workflow = this.optionalText(input.workflow, 'workflow', DEPLOYMENT_LIMITS.workflowMaxLength);

    this.assertProviderWorkflow(connection, workflow);

    const saved = await this.workflowRepo.save(
      this.workflowRepo.create({
        clientId,
        connectionId: connection.id,
        name: this.requireText(input.name, 'name', DEPLOYMENT_LIMITS.nameMaxLength),
        description: this.optionalText(input.description, 'description', DEPLOYMENT_LIMITS.descriptionMaxLength),
        repository: this.requireText(input.repository, 'repository', DEPLOYMENT_LIMITS.repositoryMaxLength),
        workflow,
        defaultRef: this.optionalText(input.defaultRef, 'defaultRef', DEPLOYMENT_LIMITS.refMaxLength),
        defaultInputs: normalizeDeploymentInputs(input.defaultInputs, 'defaultInputs'),
        scope: 'environments',
        agentIds: await this.requireAgentIds(clientId, 'environments', [id]),
        agentTriggerEnabled: input.agentTriggerEnabled === true,
        enabled: input.enabled !== false,
        createdByUserId: null,
        approvedAt: null,
        approvedByUserId: null,
        createdByType: 'agent',
        updatedByType: 'agent',
        createdByAgentId: id,
      }),
    );
    const entity = await this.findOrThrow(clientId, saved.id);
    const summary = this.toSummary(entity);

    this.publishChange(entity, summary, 'deployment_workflow.created');
    this.statisticsService
      .recordEntityCreated(StatisticsEntityType.DEPLOYMENT_WORKFLOW, entity.id, this.auditMetadata(clientId, id))
      .catch(() => undefined);

    return summary;
  }

  /**
   * Update of a workflow assigned exclusively to the environment (anything else: 404), under a row lock. Changing
   * approved content or switching it on again makes it pending; disabling keeps the approval. Scope and assignment
   * cannot be changed by environments.
   */
  async updateForAgent(
    clientId: string,
    agentId: string,
    workflowId: string,
    input: AgentDeploymentWorkflowUpdateInput,
  ): Promise<DeploymentWorkflowSummary> {
    const id = agentId.toLowerCase();

    await this.workflowRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(DeploymentWorkflowEntity);
      const entity = await this.lockOrThrow(repo, clientId, workflowId);

      if (!DeploymentWorkflowsService.isExclusivelyAssigned(entity, id)) {
        throw new NotFoundException('Deployment workflow not found');
      }

      const changed = await this.applyContent(entity, input ?? {}, (connectionId) =>
        this.findConnectionForAgent(clientId, connectionId),
      );
      const reenabled = input?.enabled === true && !entity.enabled;

      if (input?.enabled !== undefined) {
        entity.enabled = input.enabled;
      }

      if (changed.size > 0 || reenabled) {
        entity.approvedAt = null;
        entity.approvedByUserId = null;
      }

      entity.updatedByType = 'agent';
      await repo.save(entity);
    });

    const saved = await this.findOrThrow(clientId, workflowId);
    const summary = this.toSummary(saved);

    this.publishChange(saved, summary, 'deployment_workflow.updated');
    this.statisticsService
      .recordEntityUpdated(StatisticsEntityType.DEPLOYMENT_WORKFLOW, saved.id, this.auditMetadata(clientId, id))
      .catch(() => undefined);

    return summary;
  }

  /** Deletes a workflow assigned exclusively to the environment (anything else: 404) with its run history. */
  async deleteForAgent(clientId: string, agentId: string, workflowId: string): Promise<void> {
    const id = agentId.toLowerCase();
    const entity = UUID_V4.test(workflowId)
      ? await this.workflowRepo.findOne({ where: { id: workflowId, clientId }, relations: { connection: true } })
      : null;

    if (!entity || !DeploymentWorkflowsService.isExclusivelyAssigned(entity, id)) {
      throw new NotFoundException('Deployment workflow not found');
    }

    await this.removeEntity(entity, { type: 'agent', agentId: id });
  }

  // --- shared ----------------------------------------------------------------------------------------------

  static isAvailableToAgent(workflow: Pick<DeploymentWorkflowEntity, 'scope' | 'agentIds'>, agentId: string): boolean {
    return (
      workflow.scope === 'global' || (workflow.agentIds ?? []).some((id) => id.toLowerCase() === agentId.toLowerCase())
    );
  }

  /** Runs of the workflow are reachable for the environment: enabled, approved, global or assigned to it. */
  static isUsableByAgent(
    workflow: Pick<DeploymentWorkflowEntity, 'scope' | 'agentIds' | 'enabled' | 'approvedAt'>,
    agentId: string,
  ): boolean {
    return (
      workflow.enabled &&
      Boolean(workflow.approvedAt) &&
      DeploymentWorkflowsService.isAvailableToAgent(workflow, agentId)
    );
  }

  /** The environment manages the workflow itself: assigned to it and nobody else (`scope: environments`). */
  static isExclusivelyAssigned(
    workflow: Pick<DeploymentWorkflowEntity, 'scope' | 'agentIds'>,
    agentId: string,
  ): boolean {
    const ids = workflow.agentIds ?? [];

    return workflow.scope === 'environments' && ids.length === 1 && ids[0].toLowerCase() === agentId.toLowerCase();
  }

  /** 409 for pending workflows: nobody (users or environments) starts runs before a workspace admin approved them. */
  static assertApproved(workflow: Pick<DeploymentWorkflowEntity, 'approvedAt'>): void {
    if (!workflow.approvedAt) {
      throw new ConflictException(DEPLOYMENT_WORKFLOW_PENDING_MESSAGE);
    }
  }

  async findOrThrow(clientId: string, workflowId: string): Promise<DeploymentWorkflowEntity> {
    const workflow = await this.workflowRepo.findOne({
      where: { id: workflowId, clientId },
      relations: { connection: true },
    });

    if (!workflow) {
      throw new NotFoundException('Deployment workflow not found');
    }

    return workflow;
  }

  /** Enabled, approved workflows of all workspaces, paged by id (external history sync skips pending ones). */
  async findEnabledBatch(offset: number, limit: number): Promise<DeploymentWorkflowEntity[]> {
    return await this.workflowRepo.find({
      where: { enabled: true, approvedAt: Not(IsNull()) },
      relations: { connection: true },
      order: { id: 'ASC' },
      skip: Math.max(0, offset),
      take: Math.max(1, limit),
    });
  }

  /**
   * Recompute the last-run fields from the newest run (by provider start, else record time) and publish the row when
   * they changed.
   */
  async refreshLastRun(workflowId: string): Promise<void> {
    const latest = await this.runRepo
      .createQueryBuilder('r')
      .addSelect('COALESCE(r.started_at, r.created_at)', 'deployment_run_at')
      .where('r.workflow_id = :workflowId', { workflowId })
      .orderBy('deployment_run_at', 'DESC')
      .addOrderBy('r.created_at', 'DESC')
      .limit(1)
      .getOne();
    const workflow = await this.workflowRepo.findOne({ where: { id: workflowId }, relations: { connection: true } });

    if (!workflow) {
      return;
    }

    const lastRunStatus = latest?.status ?? null;
    const lastRunConclusion = latest?.conclusion ?? null;
    const lastRunAt = latest ? (latest.startedAt ?? latest.createdAt) : null;

    if (
      (workflow.lastRunStatus ?? null) === lastRunStatus &&
      (workflow.lastRunConclusion ?? null) === lastRunConclusion &&
      (workflow.lastRunAt?.getTime() ?? null) === (lastRunAt?.getTime() ?? null)
    ) {
      return;
    }

    await this.workflowRepo.update({ id: workflowId }, { lastRunStatus, lastRunConclusion, lastRunAt });

    const saved = await this.workflowRepo.findOne({ where: { id: workflowId }, relations: { connection: true } });

    if (saved) {
      this.realtime.emitWorkflowUpsert(this.toSummary(saved));
      void this.searchIndex?.upsertSafe('deployment-workflows', mapDeploymentWorkflowToSearchDocument(saved));
    }
  }

  toSummary(entity: DeploymentWorkflowEntity): DeploymentWorkflowSummary {
    return {
      id: entity.id,
      clientId: entity.clientId,
      connectionId: entity.connectionId,
      provider: entity.connection?.provider ?? 'github',
      connectionLabel: entity.connection?.label ?? '',
      name: entity.name,
      description: entity.description ?? null,
      repository: entity.repository,
      workflow: entity.workflow ?? null,
      defaultRef: entity.defaultRef ?? null,
      defaultInputs: { ...(entity.defaultInputs ?? {}) },
      scope: entity.scope,
      agentIds: [...(entity.agentIds ?? [])],
      agentTriggerEnabled: entity.agentTriggerEnabled,
      enabled: entity.enabled,
      approvalStatus: entity.approvedAt ? 'approved' : 'pending',
      approvedAt: entity.approvedAt ? entity.approvedAt.toISOString() : null,
      createdBy: entity.createdByType ?? 'user',
      updatedBy: entity.updatedByType ?? 'user',
      createdByAgentId: entity.createdByAgentId ?? null,
      lastRunStatus: entity.lastRunStatus ?? null,
      lastRunConclusion: entity.lastRunConclusion ?? null,
      lastRunAt: entity.lastRunAt ? entity.lastRunAt.toISOString() : null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private publishChange(
    entity: DeploymentWorkflowEntity,
    summary: DeploymentWorkflowSummary,
    event: 'deployment_workflow.created' | 'deployment_workflow.updated',
  ): void {
    this.realtime.emitWorkflowUpsert(summary);
    void this.searchIndex?.upsertSafe('deployment-workflows', mapDeploymentWorkflowToSearchDocument(entity));
    this.notificationPublisher?.publishDeploymentWorkflow(event, summary);
  }

  /** Shared deletion (users and environments): removes the workflow, its run documents, and publishes / audits it. */
  private async removeEntity(entity: DeploymentWorkflowEntity, actor: WorkflowActor): Promise<void> {
    const clientId = entity.clientId;
    const summary = this.toSummary(entity);
    const runIds = (await this.runRepo.find({ select: ['id'], where: { workflowId: entity.id } })).map((run) => run.id);

    await this.workflowRepo.delete({ id: entity.id, clientId });

    this.realtime.emitWorkflowRemoved({ clientId, workflowId: entity.id });
    void this.searchIndex?.deleteSafe('deployment-workflows', entity.id);

    for (const runId of runIds) {
      void this.searchIndex?.deleteSafe('deployment-runs', runId);
    }

    this.notificationPublisher?.publishDeploymentWorkflow('deployment_workflow.deleted', summary);
    this.statisticsService
      .recordEntityDeleted(
        StatisticsEntityType.DEPLOYMENT_WORKFLOW,
        entity.id,
        actor.type === 'user' ? (actor.userId ?? undefined) : undefined,
        actor.type === 'user' ? { clientId } : this.auditMetadata(clientId, actor.agentId),
      )
      .catch(() => undefined);
  }

  /** Audit metadata of changes made by an environment (no user; the environment is the actor). */
  private auditMetadata(clientId: string, agentId: string): Record<string, unknown> {
    const actor: DeploymentWorkflowActorType = 'agent';

    return { clientId, agentId, actor };
  }

  /**
   * Locks the workflow row for a read-modify-write (`FOR UPDATE` without joins, Postgres does not lock the nullable
   * side of an outer join), then loads it with its connection inside the same transaction.
   */
  private async lockOrThrow(
    repo: Repository<DeploymentWorkflowEntity>,
    clientId: string,
    workflowId: string,
  ): Promise<DeploymentWorkflowEntity> {
    const locked = UUID_V4.test(workflowId)
      ? await repo.findOne({ where: { id: workflowId, clientId }, lock: { mode: 'pessimistic_write' } })
      : null;
    const entity = locked
      ? await repo.findOne({ where: { id: workflowId, clientId }, relations: { connection: true } })
      : null;

    if (!entity) {
      throw new NotFoundException('Deployment workflow not found');
    }

    return entity;
  }

  /**
   * Applies the content fields of an update (same validation as create) and returns the ones whose value changed.
   * Scope, assignment and `enabled` are handled by the callers.
   */
  private async applyContent(
    entity: DeploymentWorkflowEntity,
    input: AgentDeploymentWorkflowUpdateInput,
    findConnection: ConnectionLookup,
  ): Promise<Set<WorkflowContentField>> {
    const changed = new Set<WorkflowContentField>();
    let connection: DeploymentConnectionEntity | undefined = entity.connection;
    const assign = <K extends WorkflowContentField>(field: K, value: DeploymentWorkflowEntity[K]): void => {
      if (!sameContentValue(entity[field], value)) {
        entity[field] = value;
        changed.add(field);
      }
    };

    if (input.connectionId !== undefined && input.connectionId !== entity.connectionId) {
      connection = await findConnection(input.connectionId);
      entity.connection = connection;
      assign('connectionId', connection.id);
    }

    if (input.name !== undefined) {
      assign('name', this.requireText(input.name, 'name', DEPLOYMENT_LIMITS.nameMaxLength));
    }

    if (input.description !== undefined) {
      assign(
        'description',
        this.optionalText(input.description, 'description', DEPLOYMENT_LIMITS.descriptionMaxLength),
      );
    }

    if (input.repository !== undefined) {
      assign('repository', this.requireText(input.repository, 'repository', DEPLOYMENT_LIMITS.repositoryMaxLength));
    }

    if (input.workflow !== undefined) {
      assign('workflow', this.optionalText(input.workflow, 'workflow', DEPLOYMENT_LIMITS.workflowMaxLength));
    }

    if (input.defaultRef !== undefined) {
      assign('defaultRef', this.optionalText(input.defaultRef, 'defaultRef', DEPLOYMENT_LIMITS.refMaxLength));
    }

    if (input.defaultInputs !== undefined) {
      assign('defaultInputs', normalizeDeploymentInputs(input.defaultInputs, 'defaultInputs'));
    }

    if (input.agentTriggerEnabled !== undefined) {
      if (typeof input.agentTriggerEnabled !== 'boolean') {
        throw new BadRequestException('agentTriggerEnabled must be a boolean');
      }

      assign('agentTriggerEnabled', input.agentTriggerEnabled);
    }

    if (connection) {
      this.assertProviderWorkflow(connection, entity.workflow ?? null);
    }

    return changed;
  }

  /** Connections of other workspaces (or revoked ones) look missing to environments. */
  private async findConnectionForAgent(clientId: string, connectionId: string): Promise<DeploymentConnectionEntity> {
    try {
      return await this.connections.findUsableOrThrow(clientId, connectionId);
    } catch (error) {
      if (error instanceof HttpException && (error.getStatus() === 403 || error.getStatus() === 404)) {
        throw new NotFoundException(
          'Deployment connection not found (agenstra_deployments_list_connections lists usable ones)',
        );
      }

      throw error;
    }
  }

  private async providerForConnection(clientId: string, connectionId: string) {
    return this.connections.providerFor(await this.connections.findUsableOrThrow(clientId, connectionId));
  }

  /** Global workflows plus the ones assigned to the environment (`agent_ids` jsonb array containment). */
  private whereAvailableToAgent(
    qb: ReturnType<Repository<DeploymentWorkflowEntity>['createQueryBuilder']>,
    agentId: string,
  ): void {
    qb.andWhere("(w.scope = 'global' OR w.agent_ids @> CAST(:agentIdsJson AS jsonb))", {
      agentIdsJson: JSON.stringify([agentId.toLowerCase()]),
    });
  }

  /** GitHub dispatches a workflow file; GitLab pipelines and Jenkins jobs have no separate workflow. */
  private assertProviderWorkflow(connection: DeploymentConnectionEntity, workflow: string | null): void {
    if (connection.provider === 'github' && !workflow) {
      throw new BadRequestException('workflow is required for GitHub Actions (workflow file name or id)');
    }
  }

  private requireScope(scope: string): DeploymentWorkflowScope {
    if (scope !== 'global' && scope !== 'environments') {
      throw new BadRequestException('scope must be global or environments');
    }

    return scope;
  }

  /**
   * Assigned environments: environments of this workspace only (deduplicated, bounded); `environments` scope needs at
   * least one. Global workflows keep no assignment.
   */
  private async requireAgentIds(
    clientId: string,
    scope: DeploymentWorkflowScope,
    value: string[] | undefined,
  ): Promise<string[]> {
    if (scope === 'global') {
      return [];
    }

    if (value !== undefined && (!Array.isArray(value) || value.some((id) => typeof id !== 'string'))) {
      throw new BadRequestException('agentIds must be a list of environment ids');
    }

    const ids = [...new Set((value ?? []).map((id) => id.trim().toLowerCase()).filter(Boolean))];

    if (ids.length === 0) {
      throw new BadRequestException('A workflow with scope environments needs at least one environment');
    }

    if (ids.length > DEPLOYMENT_LIMITS.assignedEnvironmentsMax) {
      throw new BadRequestException(
        `A workflow may be assigned to at most ${DEPLOYMENT_LIMITS.assignedEnvironmentsMax} environments`,
      );
    }

    for (const id of ids) {
      if (!UUID_V4.test(id) || !(await this.clientAgentCredentialsRepository.findByClientAndAgent(clientId, id))) {
        throw new BadRequestException(`Environment ${id} is not an environment of this workspace`);
      }
    }

    return ids;
  }

  private boundLimit(value: number | undefined, fallback: number, max: number): number {
    return Math.min(Math.max(1, Math.floor(value ?? fallback)), max);
  }

  private requireText(value: string | undefined, field: string, maxLength: number): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';

    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }

    if (trimmed.length > maxLength) {
      throw new BadRequestException(`${field} must be at most ${maxLength} characters`);
    }

    return trimmed;
  }

  private optionalText(value: string | null | undefined, field: string, maxLength: number): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }

    const trimmed = value.trim();

    if (trimmed.length > maxLength) {
      throw new BadRequestException(`${field} must be at most ${maxLength} characters`);
    }

    return trimmed || null;
  }
}

/** Value equality of workflow content fields (scalars, `null` / `undefined` alike, input maps regardless of key order). */
function sameContentValue(a: unknown, b: unknown): boolean {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const canonical = (value: object) => JSON.stringify(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)));

    return canonical(a) === canonical(b);
  }

  return (a ?? null) === (b ?? null);
}
