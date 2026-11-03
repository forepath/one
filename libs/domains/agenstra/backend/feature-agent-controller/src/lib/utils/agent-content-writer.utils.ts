import type { AgentContentChangeSource } from '@forepath/agenstra/shared/util-opencode-config';
import { getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { NotFoundException } from '@nestjs/common';

const AGENT_CONTENT_WRITER: unique symbol = Symbol('agenstra.agentContentWriter');

/**
 * An agent of a workspace changing tickets / knowledge through the platform `agenstra` MCP server (manager socket).
 * Passed instead of a user request: it is scoped to its workspace only and recorded as AI actor with the agent.
 */
export interface AgentContentWriter {
  readonly [AGENT_CONTENT_WRITER]: true;
  clientId: string;
  agentId: string;
  source: AgentContentChangeSource['kind'];
}

/** Who calls a ticket / knowledge write: a user request (or none: system) or an agent. */
export type ContentPrincipal = RequestWithUser | AgentContentWriter;

export function createAgentContentWriter(
  clientId: string,
  agentId: string,
  source: AgentContentChangeSource['kind'],
): AgentContentWriter {
  return { [AGENT_CONTENT_WRITER]: true, clientId, agentId, source };
}

export function isAgentContentWriter(value: unknown): value is AgentContentWriter {
  return !!value && typeof value === 'object' && (value as Partial<AgentContentWriter>)[AGENT_CONTENT_WRITER] === true;
}

/** User request of a principal (`undefined` for agents). */
export function principalRequest(principal: ContentPrincipal | undefined): RequestWithUser | undefined {
  return isAgentContentWriter(principal) ? undefined : principal;
}

/** User id of a principal (agents write without a user). */
export function principalUserId(principal: ContentPrincipal | undefined): string | null {
  return isAgentContentWriter(principal)
    ? null
    : (getUserFromRequest(principal || ({} as RequestWithUser)).userId ?? null);
}

/** Activity payload fields naming the agent that made a change (empty for users). */
export function agentContentAttribution(principal: ContentPrincipal | undefined): Record<string, string> {
  return isAgentContentWriter(principal) ? { agentId: principal.agentId, via: principal.source } : {};
}

/** Agents only reach their own workspace (indistinguishable from a missing element). */
export function assertAgentContentWriterWorkspace(writer: AgentContentWriter, clientId: string): void {
  if (writer.clientId !== clientId) {
    throw new NotFoundException('Not found in this workspace');
  }
}
