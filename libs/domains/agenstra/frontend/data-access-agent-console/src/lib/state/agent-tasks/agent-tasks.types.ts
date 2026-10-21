import type {
  AgentTaskRunResponseDto,
  AgentTaskRunStatus,
  AgentTaskRunTrigger,
} from '../container-socket/container-socket.types';

export type { AgentTaskRunResponseDto, AgentTaskRunStatus, AgentTaskRunTrigger };

/** Upper bound of peer agents a task may hand off to (matches the controller). */
export const AGENT_TASK_ALLOWED_HANDOFF_AGENTS_MAX = 10;

export type AgentTaskActorType = 'user' | 'agent';

/** Tasks created / changed by the agent wait for a workspace user's approval before they run (unattended, allow-all). */
export type AgentTaskApprovalStatus = 'approved' | 'pending';

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
  /** Agents of the workspace the runs may hand off work to (approved content; empty: no handoffs). */
  allowedHandoffAgentIds: string[];
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: AgentTaskRunStatus | null;
  approvalStatus: AgentTaskApprovalStatus;
  approvedAt: string | null;
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
  /**
   * Agents of the same workspace the runs may hand off work to. The edit form always sends it: a full save
   * (title, prompt, model, schedule, handoff agents) is what approves a task implicitly.
   */
  allowedHandoffAgentIds?: string[];
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
