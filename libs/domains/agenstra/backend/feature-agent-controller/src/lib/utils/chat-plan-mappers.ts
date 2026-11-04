import type { ChatPlanResponseDto } from '../dto/chat-plan';
import type { ChatPlanEntity } from '../entities/chat-plan.entity';
import { CHAT_PLAN_EDITABLE_STATUSES } from '../entities/chat-plan.enums';

/** A plan is editable until it enters execution for the first time, and never while the agent drafts it. */
export function isChatPlanEditable(row: Pick<ChatPlanEntity, 'status' | 'executionStartedAt'>): boolean {
  return !row.executionStartedAt && CHAT_PLAN_EDITABLE_STATUSES.includes(row.status);
}

export function chatPlanEntityToDto(row: ChatPlanEntity): ChatPlanResponseDto {
  return {
    id: row.id,
    shas: row.longSha ? { short: row.longSha.slice(0, 7), long: row.longSha } : null,
    clientId: row.clientId,
    agentId: row.agentId,
    chatId: row.chatId,
    status: row.status,
    phase: row.phase,
    sourcePrompt: row.sourcePrompt,
    planMarkdown: row.planMarkdown ?? null,
    summary: row.summary ?? null,
    contextInjection: row.contextInjection ?? null,
    model: row.model ?? null,
    resumeSessionSuffix: row.resumeSessionSuffix,
    completionSignalSeen: row.completionSignalSeen === true,
    failureCode: row.failureCode ?? null,
    failureMessage: row.failureMessage ?? null,
    createdByUserId: row.createdByUserId ?? null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    executionStartedAt: row.executionStartedAt ?? null,
    lastEditedAt: row.lastEditedAt ?? null,
    lastEditedByUserId: row.lastEditedByUserId ?? null,
    editable: isChatPlanEditable(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Title of a plan as context element: the agent's summary, else the original request (first line, bounded). */
export function chatPlanContextTitle(row: Pick<ChatPlanEntity, 'summary' | 'sourcePrompt'>): string {
  const title = row.summary?.trim() || row.sourcePrompt.trim().split('\n')[0] || 'Plan';

  return title.length > 200 ? `${title.slice(0, 197)}...` : title;
}

/**
 * Prompt section of a linked plan (inline context and `context_get` content). States whether the plan was executed
 * (read-only) so the agent never treats an executed plan as open work, and gives the original request for context.
 */
export function buildChatPlanContextSection(
  row: Pick<ChatPlanEntity, 'summary' | 'sourcePrompt' | 'planMarkdown' | 'status' | 'executionStartedAt' | 'longSha'>,
): string {
  const state = row.executionStartedAt
    ? `${row.status} (execution started; read-only)`
    : isChatPlanEditable(row as Pick<ChatPlanEntity, 'status' | 'executionStartedAt'>)
      ? `${row.status} (not executed; editable)`
      : `${row.status} (being drafted)`;

  return [
    `Chat Plan: ${chatPlanContextTitle(row)}`,
    ...(row.longSha ? [`Ref: plan:${row.longSha.slice(0, 7)}`] : []),
    `Status: ${state}`,
    `Original request:\n${row.sourcePrompt.trim()}`,
    `Plan:\n${row.planMarkdown?.trim() || '(no plan content yet)'}`,
  ].join('\n');
}
