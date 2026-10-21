import {
  parseAgentHandoffChatMessage,
  type AgentHandoffResponseStatus,
} from '@forepath/agenstra/shared/util-opencode-config';

/** Where a handoff card jumps to: an agent of the active workspace and one of its chats (`null`: primary chat). */
export interface AgentChatHandoffLink {
  agentId: string;
  chatId: string | null;
}

/**
 * Handoff user messages rendered as cards:
 * - `request`: first message of a handoff chat (task received from another agent) → links the source chat
 * - `response`: answer delivered into the chat the handoff was made in → links the handoff chat
 */
export interface AgentChatHandoffCardView {
  kind: 'request' | 'response';
  handoffId: string;
  title: string;
  /** The other agent (source for requests, target for responses). */
  agentName: string;
  body: string;
  status?: AgentHandoffResponseStatus;
  link: AgentChatHandoffLink;
}

/** Card view of a handoff user message, or `null` for every other message. */
export function buildAgentChatHandoffCard(text: string | null | undefined): AgentChatHandoffCardView | null {
  const parsed = parseAgentHandoffChatMessage(text);

  if (!parsed) {
    return null;
  }

  if (parsed.kind === 'request') {
    return {
      kind: 'request',
      handoffId: parsed.meta.id,
      title: parsed.meta.title,
      agentName: parsed.meta.sourceAgentName,
      body: parsed.body,
      link: { agentId: parsed.meta.sourceAgentId, chatId: parsed.meta.sourceChatId },
    };
  }

  return {
    kind: 'response',
    handoffId: parsed.meta.id,
    title: parsed.meta.title,
    agentName: parsed.meta.targetAgentName,
    body: parsed.body,
    status: parsed.meta.status,
    link: { agentId: parsed.meta.targetAgentId, chatId: parsed.meta.targetChatId },
  };
}
