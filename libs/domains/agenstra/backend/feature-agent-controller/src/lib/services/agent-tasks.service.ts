import type {
  AgentTaskActorType,
  AgentTaskCreateInput,
  AgentTaskUpdateInput,
} from '@forepath/agenstra/shared/util-opencode-config';
import { AGENT_TASK_ACTIVE_RUN_STATUSES, AGENT_TASK_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import {
  ClientAgentCredentialsRepository,
  ClientUsersRepository,
  ensureClientAccess,
  getUserFromRequest,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import {
  AGENT_TASK_RUNS_DEFAULT_LIMIT,
  AGENT_TASK_RUNS_MAX_LIMIT,
  getAgentTaskMinIntervalMs,
  getAgentTasksMaxPerAgent,
} from '../constants/agent-tasks.constants';
import type {
  AgentTaskDetailResponseDto,
  AgentTaskResponseDto,
  AgentTaskRunNowResponseDto,
  AgentTaskRunResponseDto,
  CreateAgentTaskDto,
  UpdateAgentTaskDto,
} from '../dto/agent-tasks';
import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { AgentTaskEntity } from '../entities/agent-task.entity';
import { AGENSTRA_CONTROLLER_QUEUE_NAME } from '../modules/agenstra-notifications.module';
import { ClientsRepository } from '../repositories/clients.repository';
import { agentTaskEntityToDto, agentTaskRunEntityToDto } from '../utils/agent-task-mappers';
import { enqueueAgentTaskOccurrence } from '../utils/agent-task-queue.utils';
import { computeNextAgentTaskRunAt, parseAgentTaskSchedule } from '../utils/agent-task-schedule.utils';
import { assertValidPreferredModel } from '../utils/preferred-model.utils';

import { AgentTaskRealtimeService } from './agent-task-realtime.service';

/** Every run column except `transcript`. */
const AGENT_TASK_RUN_SUMMARY_COLUMNS: Array<keyof AgentTaskRunEntity> = [
  'id',
  'taskId',
  'clientId',
  'agentId',
  'trigger',
  'status',
  'scheduledFor',
  'startedAt',
  'finishedAt',
  'outputExcerpt',
  'failureMessage',
  'awaitingHandoffSince',
  'createdAt',
  'updatedAt',
];

export interface AgentTaskRunsPageOptions {
  limit?: number;
  offset?: number;
  /** Include each run's chat events (session history). */
  includeTranscript?: boolean;
}

interface TaskActor {
  type: AgentTaskActorType;
  userId?: string | null;
}

/**
 * Recurring agent tasks. Two entry points share one validation path:
 * - workspace users (REST, {@link ensureClientAccess} like tickets / plans)
 * - the agent itself (`*ForAgent`, called by {@link AgentTaskRequestHandlerService} for the workspace bound to
 *   the manager connection and the agent authenticated by the manager) — always scoped to that agent's tasks.
 */
@Injectable()
export class AgentTasksService {
  constructor(
    @InjectRepository(AgentTaskEntity)
    private readonly taskRepo: Repository<AgentTaskEntity>,
    @InjectRepository(AgentTaskRunEntity)
    private readonly runRepo: Repository<AgentTaskRunEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly clientAgentCredentialsRepository: ClientAgentCredentialsRepository,
    private readonly realtime: AgentTaskRealtimeService,
    @Optional() @InjectQueue(AGENSTRA_CONTROLLER_QUEUE_NAME) private readonly controllerQueue?: Queue,
  ) {}

  // --- workspace users -------------------------------------------------------------------------------------

  async listForClient(clientId: string, agentId: string | undefined, req?: RequestWithUser) {
    await this.assertAccess(clientId, req);

    return (await this.findTasks(clientId, agentId)).map(agentTaskEntityToDto);
  }

  async getDetail(
    clientId: string,
    agentId: string,
    taskId: string,
    req?: RequestWithUser,
  ): Promise<AgentTaskDetailResponseDto> {
    await this.assertAccess(clientId, req);

    return this.detail(await this.findTaskOrThrow(clientId, agentId, taskId));
  }

  /** Runs newest first, paginated with `limit` / `offset` (session history infinite scroll). */
  async listRuns(
    clientId: string,
    agentId: string,
    taskId: string,
    options: AgentTaskRunsPageOptions,
    req?: RequestWithUser,
  ): Promise<AgentTaskRunResponseDto[]> {
    await this.assertAccess(clientId, req);
    const task = await this.findTaskOrThrow(clientId, agentId, taskId);
    const includeTranscript = options.includeTranscript === true;

    return (await this.findRuns(task.id, options.limit, includeTranscript, options.offset)).map((run) =>
      agentTaskRunEntityToDto(run, { includeTranscript }),
    );
  }

  async create(
    clientId: string,
    agentId: string,
    dto: CreateAgentTaskDto,
    req?: RequestWithUser,
  ): Promise<AgentTaskResponseDto> {
    await this.assertAccess(clientId, req);

    return this.createInternal(clientId, agentId, dto, this.userActor(req));
  }

  async update(
    clientId: string,
    agentId: string,
    taskId: string,
    dto: UpdateAgentTaskDto,
    req?: RequestWithUser,
  ): Promise<AgentTaskResponseDto> {
    await this.assertAccess(clientId, req);

    return this.updateInternal(clientId, agentId, taskId, dto, this.userActor(req));
  }

  async remove(clientId: string, agentId: string, taskId: string, req?: RequestWithUser): Promise<void> {
    await this.assertAccess(clientId, req);
    await this.removeInternal(await this.findTaskOrThrow(clientId, agentId, taskId));
  }

  async runNow(
    clientId: string,
    agentId: string,
    taskId: string,
    req?: RequestWithUser,
  ): Promise<AgentTaskRunNowResponseDto> {
    await this.assertAccess(clientId, req);

    return this.runNowInternal(await this.findTaskOrThrow(clientId, agentId, taskId), this.userActor(req));
  }

  /**
   * Approve what an (agent-changed) task does; only then it is scheduled and can run. `reviewedUpdatedAt` is the
   * version the user looked at: a task changed in between (e.g. by the agent) is not approved.
   */
  async approve(
    clientId: string,
    agentId: string,
    taskId: string,
    reviewedUpdatedAt: string,
    req?: RequestWithUser,
  ): Promise<AgentTaskResponseDto> {
    await this.assertAccess(clientId, req);

    const task = await this.findTaskOrThrow(clientId, agentId, taskId);

    const reviewed = new Date(reviewedUpdatedAt);

    if (Number.isNaN(reviewed.getTime()) || task.updatedAt.toISOString() !== reviewed.toISOString()) {
      throw new ConflictException('The task changed since you reviewed it; review it again before approving.');
    }

    const actor = this.userActor(req);
    const patch = {
      approvedAt: new Date(),
      approvedByUserId: actor.userId ?? null,
      nextRunAt: task.enabled ? computeNextAgentTaskRunAt(task.cronExpression, task.timezone, new Date()) : null,
    };
    // Conditional on the reviewed version: an agent change landing in between is never approved. `updated_at` keeps
    // microseconds while JS dates carry milliseconds, so the comparison is made at millisecond precision.
    const result = await this.taskRepo
      .createQueryBuilder()
      .update(AgentTaskEntity)
      .set(patch)
      .where('id = :id', { id: task.id })
      .andWhere("date_trunc('milliseconds', updated_at) = :reviewed", { reviewed: task.updatedAt })
      .execute();

    if (!result.affected) {
      throw new ConflictException('The task changed since you reviewed it; review it again before approving.');
    }

    const saved = await this.findTaskOrThrow(clientId, agentId, taskId);

    this.emitTaskUpsert(saved);

    return agentTaskEntityToDto(saved);
  }

  // --- the agent itself (manager socket) ---------------------------------------------------------------------

  async listForAgent(clientId: string, agentId: string): Promise<AgentTaskResponseDto[]> {
    return (await this.findTasks(clientId, agentId)).map(agentTaskEntityToDto);
  }

  async getForAgent(clientId: string, agentId: string, taskId: string): Promise<AgentTaskDetailResponseDto> {
    return this.detail(await this.findTaskOrThrow(clientId, agentId, taskId));
  }

  async createForAgent(clientId: string, agentId: string, input: AgentTaskCreateInput): Promise<AgentTaskResponseDto> {
    return this.createInternal(clientId, agentId, input, { type: 'agent' });
  }

  async updateForAgent(
    clientId: string,
    agentId: string,
    taskId: string,
    input: AgentTaskUpdateInput,
  ): Promise<AgentTaskResponseDto> {
    return this.updateInternal(clientId, agentId, taskId, input, { type: 'agent' });
  }

  async removeForAgent(clientId: string, agentId: string, taskId: string): Promise<void> {
    await this.removeInternal(await this.findTaskOrThrow(clientId, agentId, taskId));
  }

  async runNowForAgent(clientId: string, agentId: string, taskId: string): Promise<AgentTaskRunNowResponseDto> {
    return this.runNowInternal(await this.findTaskOrThrow(clientId, agentId, taskId), { type: 'agent' });
  }

  // --- shared ----------------------------------------------------------------------------------------------

  /** Re-publish a task row (e.g. after a run changed its last-run fields). */
  emitTaskUpsert(task: AgentTaskEntity): void {
    this.realtime.emitTaskUpsert(agentTaskEntityToDto(task));
  }

  private async createInternal(
    clientId: string,
    agentId: string,
    input: AgentTaskCreateInput,
    actor: TaskActor,
  ): Promise<AgentTaskResponseDto> {
    await this.assertAgentInClient(clientId, agentId);

    if ((await this.taskRepo.count({ where: { clientId, agentId } })) >= getAgentTasksMaxPerAgent()) {
      throw new ConflictException(`An agent can have at most ${getAgentTasksMaxPerAgent()} tasks`);
    }

    const title = this.requireText(input.title, 'title', AGENT_TASK_LIMITS.titleMaxLength);
    const prompt = this.requireText(input.prompt, 'prompt', AGENT_TASK_LIMITS.promptMaxLength);
    const schedule = parseAgentTaskSchedule(input.cronExpression ?? '', input.timezone, getAgentTaskMinIntervalMs());
    const model = this.requireModel(input.model);
    const enabled = input.enabled !== false;
    const allowedHandoffAgentIds = await this.requireHandoffAgents(clientId, agentId, input.allowedHandoffAgentIds);
    const saved = await this.taskRepo.save(
      this.taskRepo.create({
        clientId,
        agentId,
        title,
        prompt,
        ...schedule,
        model,
        enabled,
        allowedHandoffAgentIds,
        nextRunAt: enabled ? computeNextAgentTaskRunAt(schedule.cronExpression, schedule.timezone, new Date()) : null,
        createdByType: actor.type,
        createdByUserId: actor.userId ?? null,
        updatedByType: actor.type,
        // A user writing the task approves it; the agent's own tasks wait for a user.
        ...(actor.type === 'user' ? { approvedAt: new Date(), approvedByUserId: actor.userId ?? null } : {}),
      }),
    );

    this.emitTaskUpsert(saved);

    return agentTaskEntityToDto(saved);
  }

  /**
   * Read-modify-write under a row lock: an agent change and a user's approving save (or `approve`, conditional on the
   * reviewed `updated_at`) never interleave, so approval always refers to exactly the content the user wrote or saw.
   */
  private async updateInternal(
    clientId: string,
    agentId: string,
    taskId: string,
    input: AgentTaskUpdateInput,
    actor: TaskActor,
  ): Promise<AgentTaskResponseDto> {
    const saved = await this.taskRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(AgentTaskEntity);
      const task = await repo.findOne({
        where: { id: taskId, clientId, agentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!task) {
        throw new NotFoundException('Task not found');
      }

      return repo.save(await this.applyUpdate(task, input, actor));
    });

    this.emitTaskUpsert(saved);

    return agentTaskEntityToDto(saved);
  }

  private async applyUpdate(
    task: AgentTaskEntity,
    input: AgentTaskUpdateInput,
    actor: TaskActor,
  ): Promise<AgentTaskEntity> {
    if (input.title !== undefined) {
      task.title = this.requireText(input.title, 'title', AGENT_TASK_LIMITS.titleMaxLength);
    }

    if (input.prompt !== undefined) {
      task.prompt = this.requireText(input.prompt, 'prompt', AGENT_TASK_LIMITS.promptMaxLength);
    }

    if (input.model !== undefined) {
      task.model = this.requireModel(input.model);
    }

    if (input.allowedHandoffAgentIds !== undefined) {
      task.allowedHandoffAgentIds = await this.requireHandoffAgents(
        task.clientId,
        task.agentId,
        input.allowedHandoffAgentIds,
      );
    }

    const scheduleChanged = input.cronExpression !== undefined || input.timezone !== undefined;

    if (scheduleChanged) {
      const schedule = parseAgentTaskSchedule(
        input.cronExpression ?? task.cronExpression,
        input.timezone ?? task.timezone,
        getAgentTaskMinIntervalMs(),
      );

      task.cronExpression = schedule.cronExpression;
      task.timezone = schedule.timezone;
    }

    const enabledChanged = input.enabled !== undefined && input.enabled !== task.enabled;

    if (input.enabled !== undefined) {
      task.enabled = input.enabled;
    }

    // Everything the runs do (title, prompt, model, schedule, the agents they may hand off to) is approved content:
    // - the agent changing any of it, or switching the task on again, needs a user's approval;
    // - a user approves implicitly only by writing the complete content (the edit form) — partial user updates such
    //   as the enable switch never approve content the user did not submit. Disabling keeps the approval.
    const contentChanged =
      input.title !== undefined ||
      input.prompt !== undefined ||
      input.model !== undefined ||
      input.allowedHandoffAgentIds !== undefined ||
      scheduleChanged;

    if (actor.type === 'agent') {
      if (contentChanged || (enabledChanged && task.enabled)) {
        task.approvedAt = null;
        task.approvedByUserId = null;
      }
    } else if (
      input.title !== undefined &&
      input.prompt !== undefined &&
      input.model !== undefined &&
      input.cronExpression !== undefined &&
      input.allowedHandoffAgentIds !== undefined
    ) {
      this.markApproved(task, actor);
    }

    if (!task.enabled) {
      task.nextRunAt = null;
    } else if (scheduleChanged || enabledChanged || !task.nextRunAt) {
      task.nextRunAt = computeNextAgentTaskRunAt(task.cronExpression, task.timezone, new Date());
    }

    task.updatedByType = actor.type;

    return task;
  }

  private async removeInternal(task: AgentTaskEntity): Promise<void> {
    await this.taskRepo.delete({ id: task.id });
    this.realtime.emitTaskRemoved({ clientId: task.clientId, agentId: task.agentId, taskId: task.id });
  }

  private async runNowInternal(task: AgentTaskEntity, actor: TaskActor): Promise<AgentTaskRunNowResponseDto> {
    if (!this.controllerQueue) {
      throw new ServiceUnavailableException('Task runs are unavailable (queue not configured)');
    }

    if (!task.approvedAt) {
      throw new ConflictException(
        'This task waits for approval by a workspace user (console, Tasks page) before it can run.',
      );
    }

    // Manual runs requested by the agent respect the minimum interval (no run chains between tasks).
    if (
      actor.type === 'agent' &&
      task.lastRunAt &&
      Date.now() - task.lastRunAt.getTime() < getAgentTaskMinIntervalMs()
    ) {
      throw new ConflictException(
        `This task ran less than ${Math.round(getAgentTaskMinIntervalMs() / 60_000)} minutes ago; try again later.`,
      );
    }

    // A run waiting for a handoff response still occupies the task.
    if (
      (await this.runRepo.count({ where: { taskId: task.id, status: In([...AGENT_TASK_ACTIVE_RUN_STATUSES]) } })) > 0
    ) {
      return { taskId: task.id, queued: false };
    }

    await enqueueAgentTaskOccurrence(this.controllerQueue, {
      taskId: task.id,
      scheduledFor: new Date().toISOString(),
      trigger: 'manual',
    });

    return { taskId: task.id, queued: true };
  }

  private async detail(task: AgentTaskEntity): Promise<AgentTaskDetailResponseDto> {
    return {
      task: agentTaskEntityToDto(task),
      runs: (await this.findRuns(task.id, AGENT_TASK_RUNS_DEFAULT_LIMIT)).map((run) => agentTaskRunEntityToDto(run)),
    };
  }

  private findTasks(clientId: string, agentId: string | undefined): Promise<AgentTaskEntity[]> {
    return this.taskRepo.find({
      where: agentId ? { clientId, agentId } : { clientId },
      order: { createdAt: 'ASC' },
    });
  }

  /** Transcripts can be large, so they are only loaded when the session history is requested. */
  private findRuns(
    taskId: string,
    limit: number | undefined,
    includeTranscript = false,
    offset = 0,
  ): Promise<AgentTaskRunEntity[]> {
    const bounded = Math.min(
      Math.max(1, Math.floor(limit ?? AGENT_TASK_RUNS_DEFAULT_LIMIT)),
      AGENT_TASK_RUNS_MAX_LIMIT,
    );

    return this.runRepo.find({
      where: { taskId },
      // `id` breaks ties so offset pages stay stable.
      order: { startedAt: 'DESC', id: 'DESC' },
      take: bounded,
      skip: Math.max(0, Math.floor(offset)),
      ...(includeTranscript ? {} : { select: AGENT_TASK_RUN_SUMMARY_COLUMNS }),
    });
  }

  /** Tasks of other workspaces / agents are indistinguishable from missing ones. */
  private async findTaskOrThrow(clientId: string, agentId: string, taskId: string): Promise<AgentTaskEntity> {
    const task = await this.taskRepo.findOne({ where: { id: taskId, clientId, agentId } });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  private async assertAccess(clientId: string, req?: RequestWithUser): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
  }

  private markApproved(task: AgentTaskEntity, actor: TaskActor): void {
    task.approvedAt = new Date();
    task.approvedByUserId = actor.userId ?? null;
  }

  /**
   * Peer agents the runs may hand off to: other agents of the same workspace only (deduplicated, bounded). Checked
   * again when a run hands off, so agents deleted or moved later simply stop counting.
   */
  private async requireHandoffAgents(
    clientId: string,
    agentId: string,
    value: string[] | undefined,
  ): Promise<string[]> {
    if (value === undefined) {
      return [];
    }

    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
      throw new BadRequestException('allowedHandoffAgentIds must be a list of agent ids');
    }

    const ids = [...new Set(value.map((id) => id.trim().toLowerCase()).filter(Boolean))];

    if (ids.length > AGENT_TASK_LIMITS.allowedHandoffAgentsMax) {
      throw new BadRequestException(
        `A task may hand off to at most ${AGENT_TASK_LIMITS.allowedHandoffAgentsMax} agents`,
      );
    }

    for (const id of ids) {
      if (id === agentId.toLowerCase()) {
        throw new BadRequestException('A task cannot hand off to its own agent');
      }

      if (!(await this.clientAgentCredentialsRepository.findByClientAndAgent(clientId, id))) {
        throw new BadRequestException(`Agent ${id} is not an agent of this workspace`);
      }
    }

    return ids;
  }

  /** The controller only knows agents of a workspace through their stored credentials. */
  private async assertAgentInClient(clientId: string, agentId: string): Promise<void> {
    if (!(await this.clientAgentCredentialsRepository.findByClientAndAgent(clientId, agentId))) {
      throw new NotFoundException('Agent not found in this workspace');
    }
  }

  private userActor(req?: RequestWithUser): TaskActor {
    return { type: 'user', userId: getUserFromRequest(req || ({} as RequestWithUser)).userId ?? null };
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

  private requireModel(value: string | undefined): string {
    const model = assertValidPreferredModel(value);

    if (!model) {
      throw new BadRequestException('model is required (OpenCode provider/model)');
    }

    return model;
  }
}
