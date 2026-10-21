import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Socket } from 'socket.io';
import { In, MoreThanOrEqual, Repository } from 'typeorm';

import { AGENT_TASK_CHAT_HYDRATE_LIMIT, AGENT_TASK_CHAT_HYDRATE_MAX_AGE_MS } from '../constants/agent-tasks.constants';
import type { AgentTaskRunChatEventDto } from '../dto/agent-tasks';
import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { AgentTaskEntity } from '../entities/agent-task.entity';
import { agentTaskRunEntityToDto } from '../utils/agent-task-mappers';

import { AgentConsoleStatusService } from './agent-console-status.service';
import { AgentTaskRealtimeService } from './agent-task-realtime.service';

const OPEN_TASK_LABEL = 'View task';

/** Task runs as structured cards in the agent's main chat (mirrors ticket automation run cards). */
@Injectable()
export class AgentTaskChatSyncService {
  private readonly logger = new Logger(AgentTaskChatSyncService.name);

  constructor(
    @InjectRepository(AgentTaskRunEntity)
    private readonly runRepo: Repository<AgentTaskRunEntity>,
    @InjectRepository(AgentTaskEntity)
    private readonly taskRepo: Repository<AgentTaskEntity>,
    private readonly realtime: AgentTaskRealtimeService,
    private readonly agentConsoleStatusService: AgentConsoleStatusService,
  ) {}

  /** After agent login: replay run cards for this client + agent (unicast), oldest first. */
  async hydrateForAgentClient(socket: Socket, clientId: string, agentId: string): Promise<void> {
    const runs = await this.runRepo.find({
      where: {
        clientId,
        agentId,
        startedAt: MoreThanOrEqual(new Date(Date.now() - AGENT_TASK_CHAT_HYDRATE_MAX_AGE_MS)),
      },
      order: { startedAt: 'DESC' },
      take: AGENT_TASK_CHAT_HYDRATE_LIMIT,
    });

    if (runs.length === 0) {
      return;
    }

    const tasks = await this.taskRepo.find({ where: { id: In([...new Set(runs.map((run) => run.taskId))]) } });
    const tasksById = new Map(tasks.map((task) => [task.id, task]));

    for (const run of runs.reverse()) {
      const task = tasksById.get(run.taskId);

      if (task) {
        this.realtime.emitRunChatUpsertToSocket(socket, this.buildPayload(task, run, true));
      }
    }

    this.logger.debug(`Hydrated ${runs.length} task run(s) for chat, client=${clientId} agent=${agentId}`);
  }

  /** Live run card to every socket in the workspace room. */
  emitLiveRunUpdate(task: AgentTaskEntity, run: AgentTaskRunEntity): void {
    this.realtime.emitRunChatUpsert(run.clientId, this.buildPayload(task, run, false));
    void this.agentConsoleStatusService
      .onAutomationChatActivity(run.clientId, run.agentId, run.updatedAt ?? new Date())
      .catch(() => undefined);
  }

  buildPayload(task: AgentTaskEntity, run: AgentTaskRunEntity, hydrate: boolean): AgentTaskRunChatEventDto {
    const updatedAt = run.finishedAt ?? run.updatedAt ?? run.startedAt;

    return {
      timelineAt: (hydrate ? run.startedAt : updatedAt).toISOString(),
      hydrate,
      task: {
        id: task.id,
        clientId: task.clientId,
        agentId: task.agentId,
        title: task.title,
        cronExpression: task.cronExpression,
        timezone: task.timezone,
        enabled: task.enabled,
      },
      run: agentTaskRunEntityToDto(run),
      actions: [{ type: 'openAgentTask', taskId: task.id, runId: run.id, label: OPEN_TASK_LABEL }],
    };
  }
}
