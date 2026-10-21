import {
  AGENSTRA_HANDOFF_RESPOND_TOOL_ID,
  buildAgentHandoffRequestMessage,
  buildAgentHandoffResponseMessage,
  type AgentHandoffResponseStatus,
} from '@forepath/agenstra/shared/util-opencode-config';

import { AGENT_HANDOFF_FALLBACK_RESPONSE_MAX_LENGTH } from '../constants/agent-handoffs.constants';
import type { AgentHandoffEntity } from '../entities/agent-handoff.entity';

type HandoffPromptFields = Pick<
  AgentHandoffEntity,
  | 'id'
  | 'title'
  | 'message'
  | 'sourceAgentId'
  | 'sourceAgentName'
  | 'sourceChatId'
  | 'targetAgentId'
  | 'targetAgentName'
  | 'targetChatId'
  | 'response'
  | 'failureMessage'
>;

function respondInstruction(handoff: Pick<HandoffPromptFields, 'id'>): string {
  return (
    `call the tool ${AGENSTRA_HANDOFF_RESPOND_TOOL_ID} exactly once with handoffId "${handoff.id}", ` +
    `status "completed" or "failed" and a self-contained response (results, changes, open points)`
  );
}

/**
 * First message of the handoff chat on the target agent: the task as written by the source agent plus the response
 * protocol (hidden in the console card).
 */
export function buildAgentHandoffTargetMessage(handoff: HandoffPromptFields): string {
  return buildAgentHandoffRequestMessage(
    {
      id: handoff.id,
      title: handoff.title,
      sourceAgentId: handoff.sourceAgentId,
      sourceAgentName: handoff.sourceAgentName,
      sourceChatId: handoff.sourceChatId,
    },
    `# ${handoff.title}\n\n${handoff.message}`,
    `The agent "${handoff.sourceAgentName}" of your workspace handed this task over to you. It does not see this ` +
      `chat. Work on the task here. When you are done, or when you cannot complete it, ${respondInstruction(handoff)}. ` +
      `Only that response reaches the requesting agent.`,
  );
}

/** Repair turn (sent hidden into the handoff chat) when a target turn ended without a response. */
export function buildAgentHandoffRepairPrompt(handoff: HandoffPromptFields): string {
  return (
    `You have not answered the handed-over task "${handoff.title}" yet. Do not start new work: ` +
    `${respondInstruction(handoff)} for the agent "${handoff.sourceAgentName}" now.`
  );
}

/** Message that delivers the outcome into the chat the handoff was made in (a new turn of the source agent). */
export function buildAgentHandoffDeliveryMessage(
  handoff: HandoffPromptFields,
  status: AgentHandoffResponseStatus,
): string {
  const body =
    status === 'completed'
      ? handoff.response?.trim() || 'The agent completed the task without further details.'
      : [handoff.response?.trim(), handoff.failureMessage?.trim()].filter(Boolean).join('\n\n') ||
        'The handoff failed.';
  const instructions =
    status === 'completed'
      ? `This is the response of the agent "${handoff.targetAgentName}" to the task you handed over ` +
        `("${handoff.title}", handoffId "${handoff.id}"). Continue with the work that depended on it.`
      : `The task you handed over to the agent "${handoff.targetAgentName}" ("${handoff.title}", handoffId ` +
        `"${handoff.id}") could not be completed. Decide how to continue and tell the user if it matters to them.`;

  return buildAgentHandoffResponseMessage(
    {
      id: handoff.id,
      title: handoff.title,
      status,
      targetAgentId: handoff.targetAgentId,
      targetAgentName: handoff.targetAgentName,
      targetChatId: handoff.targetChatId,
    },
    body,
    instructions,
  );
}

/** Response used when the target never called the respond tool: the tail of its last answer, if any. */
export function buildAgentHandoffFallbackResponse(lastAnswer: string | undefined): string | null {
  const text = lastAnswer?.trim() ?? '';

  if (!text) {
    return null;
  }

  const tail =
    text.length > AGENT_HANDOFF_FALLBACK_RESPONSE_MAX_LENGTH
      ? `…${text.slice(text.length - AGENT_HANDOFF_FALLBACK_RESPONSE_MAX_LENGTH)}`
      : text;

  return `(The agent did not send an explicit response; this is its last answer.)\n\n${tail}`;
}
