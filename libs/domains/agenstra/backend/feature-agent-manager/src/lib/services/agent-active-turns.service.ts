import { Injectable } from '@nestjs/common';

import {
  PRIMARY_CHAT_RESUME_SESSION_SUFFIX,
  USER_CHAT_RESUME_SESSION_SUFFIX_PREFIX,
} from '../constants/chat-session.constants';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Context a running OpenCode turn belongs to, derived from its resume session suffix. */
export type AgentTurnContext = { kind: 'primary' } | { kind: 'chat'; chatId: string } | { kind: 'hidden' };

/**
 * Where a call of the agent's MCP server (which carries no session) comes from:
 * - `visible`: every running turn of the agent belongs to this one visible chat
 * - `hidden`: the only working contexts are hidden sessions (task runs, ticket automation, plan / helper sessions)
 * - `ambiguous`: several contexts are working at the same time
 * - `idle`: no turn is running (the call cannot come from a chat turn)
 */
export type AgentCallingContext =
  | { kind: 'visible'; context: Exclude<AgentTurnContext, { kind: 'hidden' }> }
  | { kind: 'hidden' }
  | { kind: 'ambiguous' }
  | { kind: 'idle' };

export function resolveAgentTurnContext(resumeSessionSuffix: string | undefined): AgentTurnContext {
  const suffix = resumeSessionSuffix ?? PRIMARY_CHAT_RESUME_SESSION_SUFFIX;

  if (suffix === PRIMARY_CHAT_RESUME_SESSION_SUFFIX) {
    return { kind: 'primary' };
  }

  if (suffix.startsWith(USER_CHAT_RESUME_SESSION_SUFFIX_PREFIX)) {
    const chatId = suffix.slice(USER_CHAT_RESUME_SESSION_SUFFIX_PREFIX.length);

    if (UUID_V4.test(chatId)) {
      return { kind: 'chat', chatId: chatId.toLowerCase() };
    }
  }

  return { kind: 'hidden' };
}

function contextKey(context: AgentTurnContext): string {
  return context.kind === 'chat' ? `chat:${context.chatId}` : context.kind;
}

/**
 * Running OpenCode turns per agent (registered by the OpenCode runtime for every prompt). Platform MCP calls carry
 * no session, so this tells which chat a call belongs to — and when that cannot be told reliably.
 */
@Injectable()
export class AgentActiveTurnsService {
  private nextTurnId = 0;
  private readonly turnsByAgent = new Map<string, Map<number, AgentTurnContext>>();

  /** Register a running turn; call the returned function exactly when the turn ended (idempotent). */
  begin(agentId: string, resumeSessionSuffix: string | undefined): () => void {
    const turnId = this.nextTurnId++;
    const turns = this.turnsByAgent.get(agentId) ?? new Map<number, AgentTurnContext>();

    turns.set(turnId, resolveAgentTurnContext(resumeSessionSuffix));
    this.turnsByAgent.set(agentId, turns);

    return () => {
      turns.delete(turnId);

      if (turns.size === 0 && this.turnsByAgent.get(agentId) === turns) {
        this.turnsByAgent.delete(agentId);
      }
    };
  }

  callingContext(agentId: string): AgentCallingContext {
    const contexts = new Map<string, AgentTurnContext>();

    for (const context of this.turnsByAgent.get(agentId)?.values() ?? []) {
      contexts.set(contextKey(context), context);
    }

    if (contexts.size === 0) {
      return { kind: 'idle' };
    }

    if (contexts.size > 1) {
      return { kind: 'ambiguous' };
    }

    const [context] = contexts.values();

    return context.kind === 'hidden' ? { kind: 'hidden' } : { kind: 'visible', context };
  }
}
