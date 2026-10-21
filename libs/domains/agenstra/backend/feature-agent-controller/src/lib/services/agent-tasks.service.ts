import type {
  AgentTaskActorType,
  AgentTaskCreateInput,
  AgentTaskUpdateInput,
} from '@forepath/agenstra/shared/util-opencode-config';
import { AGENT_TASK_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
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
import { Repository } from 'typeorm';

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

    return this.updateInternal(await this.findTaskOrThrow(clientId, agentId, taskId), dto, this.userActor(req));
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

    return this.runNowInternal(await this.findTaskOrThrow(clientId, agentId, taskId));
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
    return this.updateInternal(await this.findTaskOrThrow(clientId, agentId, taskId), input, { type: 'agent' });
  }

  async removeForAgent(clientId: string, agentId: string, taskId: string): Promise<void> {
    await this.removeInternal(await this.findTaskOrThrow(clientId, agentId, taskId));
  }

  async runNowForAgent(clientId: string, agentId: string, taskId: string): Promise<AgentTaskRunNowResponseDto> {
    return this.runNowInternal(await this.findTaskOrThrow(clientId, agentId, taskId));
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
    const saved = await this.taskRepo.save(
      this.taskRepo.create({
        clientId,
        agentId,
        title,
        prompt,
        ...schedule,
        model,
        enabled,
        nextRunAt: enabled ? computeNextAgentTaskRunAt(schedule.cronExpression, schedule.timezone, new Date()) : null,
        createdByType: actor.type,
        createdByUserId: actor.userId ?? null,
        updatedByType: actor.type,
      }),
    );

    this.emitTaskUpsert(saved);

    return agentTaskEntityToDto(saved);
  }

  private async updateInternal(
    task: AgentTaskEntity,
    input: AgentTaskUpdateInput,
    actor: TaskActor,
  ): Promise<AgentTaskResponseDto> {
    if (input.title !== undefined) {
      task.title = this.requireText(input.title, 'title', AGENT_TASK_LIMITS.titleMaxLength);
    }

    if (input.prompt !== undefined) {
      task.prompt = this.requireText(input.prompt, 'prompt', AGENT_TASK_LIMITS.promptMaxLength);
    }

    if (input.model !== undefined) {
      task.model = this.requireModel(input.model);
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

    if (!task.enabled) {
      task.nextRunAt = null;
    } else if (scheduleChanged || enabledChanged || !task.nextRunAt) {
      task.nextRunAt = computeNextAgentTaskRunAt(task.cronExpression, task.timezone, new Date());
    }

    task.updatedByType = actor.type;

    const saved = await this.taskRepo.save(task);

    this.emitTaskUpsert(saved);

    return agentTaskEntityToDto(saved);
  }

  private async removeInternal(task: AgentTaskEntity): Promise<void> {
    await this.taskRepo.delete({ id: task.id });
    this.realtime.emitTaskRemoved({ clientId: task.clientId, agentId: task.agentId, taskId: task.id });
  }

  private async runNowInternal(task: AgentTaskEntity): Promise<AgentTaskRunNowResponseDto> {
    if (!this.controllerQueue) {
      throw new ServiceUnavailableException('Task runs are unavailable (queue not configured)');
    }

    if ((await this.runRepo.count({ where: { taskId: task.id, status: 'running' } })) > 0) {
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
