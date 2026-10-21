import type { AgentTaskRunResponseDto } from './agent-task-response.dto';

export interface AgentTaskRunChatTaskSummaryDto {
  id: string;
  clientId: string;
  agentId: string;
  title: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
}

export interface AgentTaskRunChatOpenActionDto {
  type: 'openAgentTask';
  taskId: string;
  runId: string;
  label: string;
}

/**
 * Server → client payload on namespace `clients`, event `agentTaskRunChatUpsert`. Rendered as a structured card in
 * the agent's main chat. `timelineAt` is ISO-8601: hydrate rows use `run.startedAt`, live updates the update time.
 */
export interface AgentTaskRunChatEventDto {
  timelineAt: string;
  hydrate: boolean;
  task: AgentTaskRunChatTaskSummaryDto;
  run: AgentTaskRunResponseDto;
  actions: AgentTaskRunChatOpenActionDto[];
}
