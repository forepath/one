import type { AgentTaskRunSummary, AgentTaskSummary } from '@forepath/agenstra/shared/util-opencode-config';

import type { AgentTaskTranscriptEvent } from '../../utils/agent-task-transcript.utils';

/** Task row for REST, the `/tasks` page and the agent (MCP). Timestamps are ISO-8601 strings. */
export interface AgentTaskResponseDto extends AgentTaskSummary {
  clientId: string;
}

export interface AgentTaskRunResponseDto extends AgentTaskRunSummary {
  clientId: string;
  /** Chat events of the run's turn (only with `includeTranscript=true`). */
  transcript?: AgentTaskTranscriptEvent[];
}

export interface AgentTaskDetailResponseDto {
  task: AgentTaskResponseDto;
  runs: AgentTaskRunResponseDto[];
}

export interface AgentTaskRunNowResponseDto {
  taskId: string;
  /** False when a run of this task is still in progress (no second run is queued). */
  queued: boolean;
}

/** Payload of {@link AGENT_TASK_SOCKET_EVENTS.taskRemoved}. */
export interface AgentTaskRemovedEventDto {
  clientId: string;
  agentId: string;
  taskId: string;
}
