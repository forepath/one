import type {
  AgentTaskRunResponseDto,
  AgentTaskRunStatus,
  AgentTaskRunTrigger,
} from '../container-socket/container-socket.types';

export type { AgentTaskRunResponseDto, AgentTaskRunStatus, AgentTaskRunTrigger };

export type AgentTaskActorType = 'user' | 'agent';

/** Recurring agent task (agent-controller `GET /clients/:clientId/agent-tasks`). */
export interface AgentTaskResponseDto {
  id: string;
  clientId: string;
  agentId: string;
  title: string;
  prompt: string;
  /** Five-field cron expression (minute hour day-of-month month day-of-week). */
  cronExpression: string;
  /** IANA time zone the cron expression is evaluated in. */
  timezone: string;
  /** OpenCode `provider/model` used for runs. */
  model: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: AgentTaskRunStatus | null;
  createdBy: AgentTaskActorType;
  updatedBy: AgentTaskActorType;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentTaskDto {
  title: string;
  prompt: string;
  cronExpression: string;
  timezone?: string;
  model: string;
  enabled?: boolean;
}

export type UpdateAgentTaskDto = Partial<CreateAgentTaskDto>;

export interface AgentTaskDetailResponseDto {
  task: AgentTaskResponseDto;
  runs: AgentTaskRunResponseDto[];
}

export interface AgentTaskRunNowResponseDto {
  taskId: string;
  queued: boolean;
}

/** `agentTaskRemoved` socket payload. */
export interface AgentTaskRemovedEvent {
  clientId: string;
  agentId: string;
  taskId: string;
}
