import type { ChatPlanResponseDto } from '../dto/chat-plan';
import type { ChatPlanEntity } from '../entities/chat-plan.entity';

export function chatPlanEntityToDto(row: ChatPlanEntity): ChatPlanResponseDto {
  return {
    id: row.id,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
