import { Injectable, Logger } from '@nestjs/common';

/** How long an API request waits for the matching tool call to show up in the worker's event stream. */
export const AGENT_TOOL_CALL_CLAIM_WAIT_MS = 10_000;
const AGENT_TOOL_CALL_CLAIM_POLL_MS = 100;
/** Observed tool calls / message relations are forgotten after this long. */
const AGENT_TOOL_CALL_TTL_MS = 2 * 60 * 60_000;
/** Per agent: one busy worker can never evict another agent's state. */
const AGENT_TOOL_CALLS_MAX_PER_AGENT = 500;
const AGENT_RELATIONS_MAX_PER_AGENT = 5_000;
/** Only platform context / content / deployment tools authorize anything (auto tickets of unattended runs). */
const TRACKED_TOOL_PREFIXES = ['agenstra_context_', 'agenstra_content_', 'agenstra_deployments_'];
/** Unknown answer messages are looked up in their session at most this often (claims poll every 100 ms). */
const MESSAGE_LOOKUP_INTERVAL_MS = 1_000;
/** Subagents of subagents: bounded walk up the chain. */
const MAX_CHAIN_DEPTH = 8;
const CONTEXT_TICKET_PATTERN = /ctx-[A-Za-z0-9_-]{16,}/g;

interface ObservedToolCall {
  agentId: string;
  messageId: string;
  sessionId?: string;
  tool: string;
  input: Record<string, unknown>;
  observedAt: number;
  claimed: boolean;
}

/** Messages of one OpenCode session (`info` of the session messages API), oldest first. */
export type AgentSessionMessageLookup = (sessionId: string) => Promise<Array<Record<string, unknown>>>;

interface ObservedMessage {
  sessionId: string;
  role: string;
  parentId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Tool calls of the platform's own prompts, observed from the worker's OpenCode event stream. Platform MCP requests
 * carry no session; for privileged tickets (auto-approval sessions) a request is only accepted when it matches a tool
 * call that answers the prompt the platform sent with that ticket:
 * - the root is the first user message that contains the ticket — the platform's prompt (the ticket is random and
 *   only becomes readable for anyone else after that message exists);
 * - accepted are assistant messages answering that user message, and subagent sessions started by a `task` tool call
 *   inside them (answers to their first, task-created user message).
 * Prompts a background process injects through the OpenCode API (into the session or a session it created below it)
 * are never part of that chain.
 */
@Injectable()
export class AgentToolCallsService {
  private readonly logger = new Logger(AgentToolCallsService.name);

  private readonly calls = new Map<string, ObservedToolCall>();
  /** Per agent: messageId → message. */
  private readonly messages = new Map<string, Map<string, ObservedMessage>>();
  /** Per agent: sessionId → first user message id of that session. */
  private readonly firstUserMessages = new Map<string, Map<string, string>>();
  /** Per agent: ticket → `messageId` of the first user message containing it (text part). */
  private readonly ticketRoots = new Map<string, Map<string, string>>();
  /** Per agent: child sessionId → assistant message id holding the `task` tool call that started it. */
  private readonly subagentOrigins = new Map<string, Map<string, string>>();
  /** Per agent: session messages lookup of its worker (registered by the runtime when it sends a prompt). */
  private readonly messageLookups = new Map<string, AgentSessionMessageLookup>();
  /** Per agent: sessionId → time of the last message lookup. */
  private readonly lookupTimes = new Map<string, Map<string, number>>();

  /** Feed any raw OpenCode event of the agent's worker. */
  observe(agentId: string, event: unknown): void {
    const root = asRecord(event);
    const properties = asRecord(root?.['properties']);

    if (root?.['type'] === 'message.updated') {
      this.observeMessage(agentId, asRecord(properties?.['info']));

      return;
    }

    if (root?.['type'] !== 'message.part.updated') {
      return;
    }

    const part = asRecord(properties?.['part']);
    const messageId = asString(part?.['messageID']);

    if (!part || !messageId) {
      return;
    }

    if (part['type'] === 'text' && typeof part['text'] === 'string') {
      this.observeText(agentId, messageId, part['text']);

      return;
    }

    if (part['type'] === 'tool') {
      this.observeTool(agentId, messageId, part);
    }
  }

  /**
   * Authoritative root for the tickets in a prompt the platform sent: the runtime looked up its own user message in
   * the session history (earliest user message with exactly that text), covering events missed while the worker
   * stream was still connecting.
   */
  registerPromptRoot(agentId: string, sessionId: string, messageId: string, promptText: string): void {
    this.put(this.messages, agentId, messageId, { sessionId, role: 'user' });

    for (const ticket of promptText.match(CONTEXT_TICKET_PATTERN) ?? []) {
      this.put(this.ticketRoots, agentId, ticket, messageId);
    }
  }

  /**
   * Session messages of the agent's worker. The worker event stream is opened when a turn starts, so the creation of
   * a turn's first answer message (with its parent) can precede it; such messages are looked up when a claim needs
   * them (the same source the stream reports from).
   */
  registerMessageLookup(agentId: string, lookup: AgentSessionMessageLookup): void {
    this.messageLookups.set(agentId, lookup);
  }

  /**
   * Claim one running call of `tool` that answers the platform's prompt carrying `ticket` (directly or in a subagent
   * started from it) and whose input satisfies `matches`. Waits briefly: the MCP request and the events race. Each
   * tool call authorizes exactly one request.
   */
  async claim(
    agentId: string,
    ticket: string,
    tool: string,
    matches: (input: Record<string, unknown>) => boolean,
    waitMs = AGENT_TOOL_CALL_CLAIM_WAIT_MS,
  ): Promise<boolean> {
    const deadline = Date.now() + waitMs;

    for (;;) {
      const rootMessageId = this.ticketRoots.get(agentId)?.get(ticket);

      if (rootMessageId && this.isUserMessage(agentId, rootMessageId)) {
        for (const call of this.calls.values()) {
          if (
            !call.claimed &&
            call.agentId === agentId &&
            call.tool === tool &&
            matches(call.input) &&
            this.answers(agentId, call.messageId, rootMessageId, 0)
          ) {
            call.claimed = true;

            return true;
          }
        }
      }

      if (Date.now() >= deadline) {
        this.logClaimFailure(agentId, ticket, tool, rootMessageId);

        return false;
      }

      await this.lookupUnknownMessages(agentId, tool);
      await new Promise((resolve) => setTimeout(resolve, AGENT_TOOL_CALL_CLAIM_POLL_MS));
    }
  }

  /** Why a claim failed (debug only; no inputs or ticket values are logged). */
  private logClaimFailure(agentId: string, ticket: string, tool: string, rootMessageId: string | undefined): void {
    const calls = [...this.calls.values()].filter((call) => call.agentId === agentId && call.tool === tool);
    const reason = !rootMessageId
      ? 'no platform prompt carries the ticket'
      : !this.isUserMessage(agentId, rootMessageId)
        ? 'the ticket root is not a known user message'
        : calls.length === 0
          ? 'no running call of the tool was observed'
          : calls.every((call) => call.claimed)
            ? 'every observed call was already claimed'
            : 'no observed call matches the arguments and answers the ticket prompt';

    this.logger.debug(
      `Tool call claim refused for agent ${agentId} (${tool}, ticket ${ticket.slice(0, 8)}…): ${reason} ` +
        `(observed calls: ${calls.length})`,
    );
  }

  /** Sessions with unclaimed calls of `tool` whose message is unknown: record their messages from the worker. */
  private async lookupUnknownMessages(agentId: string, tool: string): Promise<void> {
    const lookup = this.messageLookups.get(agentId);

    if (!lookup) {
      return;
    }

    const known = this.messages.get(agentId);
    const sessions = new Set<string>();

    for (const call of this.calls.values()) {
      if (
        !call.claimed &&
        call.agentId === agentId &&
        call.tool === tool &&
        call.sessionId &&
        !known?.has(call.messageId)
      ) {
        sessions.add(call.sessionId);
      }
    }

    for (const sessionId of sessions) {
      const last = this.lookupTimes.get(agentId)?.get(sessionId) ?? 0;

      if (Date.now() - last < MESSAGE_LOOKUP_INTERVAL_MS) {
        continue;
      }

      this.put(this.lookupTimes, agentId, sessionId, Date.now());

      try {
        for (const info of await lookup(sessionId)) {
          // Only the call's own session: a lookup never moves messages into another session.
          if (asString(info['sessionID']) === sessionId) {
            this.observeMessage(agentId, info);
          }
        }
      } catch {
        // Worker unreachable: the claim keeps waiting for the stream.
      }
    }
  }

  private observeMessage(agentId: string, info: Record<string, unknown> | undefined): void {
    const id = asString(info?.['id']);
    const sessionId = asString(info?.['sessionID']);
    const role = asString(info?.['role']);

    if (!id || !sessionId || !role) {
      return;
    }

    this.put(this.messages, agentId, id, {
      sessionId,
      role,
      ...(asString(info?.['parentID']) ? { parentId: asString(info?.['parentID']) } : {}),
    });

    if (role === 'user' && !this.of(this.firstUserMessages, agentId).has(sessionId)) {
      this.put(this.firstUserMessages, agentId, sessionId, id);
    }
  }

  private observeText(agentId: string, messageId: string, text: string): void {
    for (const match of text.match(CONTEXT_TICKET_PATTERN) ?? []) {
      // First occurrence wins: the platform's prompt introduces the ticket.
      if (!this.of(this.ticketRoots, agentId).has(match)) {
        this.put(this.ticketRoots, agentId, match, messageId);
      }
    }
  }

  private observeTool(agentId: string, messageId: string, part: Record<string, unknown>): void {
    const state = asRecord(part['state']);
    const tool = asString(part['tool']);
    const callId = asString(part['callID']) ?? asString(part['id']);

    if (!tool || !callId) {
      return;
    }

    // Subagent session started by a `task` tool call (OpenCode reports the child session in the metadata).
    const childSessionId =
      asString(asRecord(state?.['metadata'])?.['sessionId']) ??
      asString(asRecord(state?.['metadata'])?.['sessionID']) ??
      asString(asRecord(part['metadata'])?.['sessionId']) ??
      asString(asRecord(part['metadata'])?.['sessionID']);

    if (childSessionId && !this.of(this.subagentOrigins, agentId).has(childSessionId)) {
      this.put(this.subagentOrigins, agentId, childSessionId, messageId);
    }

    const input = asRecord(state?.['input']);
    const key = `${agentId}|${callId}`;

    if (
      !TRACKED_TOOL_PREFIXES.some((prefix) => tool.startsWith(prefix)) ||
      state?.['status'] !== 'running' ||
      !input ||
      this.calls.has(key)
    ) {
      return;
    }

    this.purgeCalls(agentId);
    this.calls.set(key, {
      agentId,
      messageId,
      sessionId: asString(part['sessionID']),
      tool,
      input,
      observedAt: Date.now(),
      claimed: false,
    });
  }

  private isUserMessage(agentId: string, messageId: string): boolean {
    return this.messages.get(agentId)?.get(messageId)?.role === 'user';
  }

  /** Is `assistantMessageId` an answer to `rootMessageId`, directly or in a subagent started from such an answer? */
  private answers(agentId: string, assistantMessageId: string, rootMessageId: string, depth: number): boolean {
    const message = this.messages.get(agentId)?.get(assistantMessageId);

    if (!message || message.role !== 'assistant' || !message.parentId || depth > MAX_CHAIN_DEPTH) {
      return false;
    }

    if (message.parentId === rootMessageId) {
      return true;
    }

    // Subagent session: only answers to its first (task-created) prompt, and only if a task call of the chain
    // started it.
    const origin = this.subagentOrigins.get(agentId)?.get(message.sessionId);
    const firstUser = this.firstUserMessages.get(agentId)?.get(message.sessionId);

    return (
      !!origin &&
      !!firstUser &&
      message.parentId === firstUser &&
      this.answers(agentId, origin, rootMessageId, depth + 1)
    );
  }

  /** The agent's own map (created on demand). */
  private of<V>(maps: Map<string, Map<string, V>>, agentId: string): Map<string, V> {
    let map = maps.get(agentId);

    if (!map) {
      map = new Map<string, V>();
      maps.set(agentId, map);
    }

    return map;
  }

  /** Insert into the agent's own map; when it exceeds its share its oldest entries go (other agents untouched). */
  private put<V>(maps: Map<string, Map<string, V>>, agentId: string, key: string, value: V): void {
    const map = this.of(maps, agentId);

    map.delete(key);
    map.set(key, value);

    while (map.size > AGENT_RELATIONS_MAX_PER_AGENT) {
      map.delete(map.keys().next().value as string);
    }
  }

  private purgeCalls(agentId: string): void {
    const cutoff = Date.now() - AGENT_TOOL_CALL_TTL_MS;
    const own: string[] = [];

    for (const [key, call] of this.calls) {
      if (call.observedAt < cutoff) {
        this.calls.delete(key);
      } else if (call.agentId === agentId) {
        own.push(key);
      }
    }

    for (const key of own.slice(0, Math.max(0, own.length - AGENT_TOOL_CALLS_MAX_PER_AGENT + 1))) {
      this.calls.delete(key);
    }
  }
}
