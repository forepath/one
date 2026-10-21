import type { AgentHandoffSummary } from '@forepath/agenstra/shared/util-opencode-config';

import type { AgentHandoffEntity } from '../entities/agent-handoff.entity';

export function agentHandoffEntityToSummary(entity: AgentHandoffEntity): AgentHandoffSummary {
  return {
    id: entity.id,
    sourceAgentId: entity.sourceAgentId,
    sourceAgentName: entity.sourceAgentName,
    sourceChatId: entity.sourceChatId ?? null,
    sourceTaskId: entity.sourceTaskId ?? null,
    sourceTaskRunId: entity.sourceTaskRunId ?? null,
    targetAgentId: entity.targetAgentId,
    targetAgentName: entity.targetAgentName,
    targetChatId: entity.targetChatId,
    title: entity.title,
    message: entity.message,
    status: entity.status,
    response: entity.response ?? null,
    failureMessage: entity.failureMessage ?? null,
    delivery: entity.deliveredAt ? 'delivered' : entity.deliveryFailureMessage ? 'undeliverable' : 'pending',
    deliveryFailureMessage: entity.deliveryFailureMessage ?? null,
    createdAt: entity.createdAt.toISOString(),
    finishedAt: entity.finishedAt ? entity.finishedAt.toISOString() : null,
  };
}
