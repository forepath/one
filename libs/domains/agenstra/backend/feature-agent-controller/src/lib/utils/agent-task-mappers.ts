import type { AgentTaskResponseDto, AgentTaskRunResponseDto } from '../dto/agent-tasks';
import type { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import type { AgentTaskEntity } from '../entities/agent-task.entity';

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function agentTaskEntityToDto(task: AgentTaskEntity): AgentTaskResponseDto {
  return {
    id: task.id,
    clientId: task.clientId,
    agentId: task.agentId,
    title: task.title,
    prompt: task.prompt,
    cronExpression: task.cronExpression,
    timezone: task.timezone,
    model: task.model,
    enabled: task.enabled,
    nextRunAt: iso(task.nextRunAt),
    lastRunAt: iso(task.lastRunAt),
    lastRunStatus: task.lastRunStatus ?? null,
    createdBy: task.createdByType,
    updatedBy: task.updatedByType,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/** `includeTranscript` adds the run's chat events (session history); lists and chat cards omit them. */
export function agentTaskRunEntityToDto(
  run: AgentTaskRunEntity,
  options: { includeTranscript?: boolean } = {},
): AgentTaskRunResponseDto {
  return {
    id: run.id,
    taskId: run.taskId,
    clientId: run.clientId,
    agentId: run.agentId,
    trigger: run.trigger,
    status: run.status,
    scheduledFor: run.scheduledFor.toISOString(),
    startedAt: run.startedAt.toISOString(),
    finishedAt: iso(run.finishedAt),
    outputExcerpt: run.outputExcerpt ?? null,
    failureMessage: run.failureMessage ?? null,
    ...(options.includeTranscript ? { transcript: run.transcript ?? [] } : {}),
  };
}
