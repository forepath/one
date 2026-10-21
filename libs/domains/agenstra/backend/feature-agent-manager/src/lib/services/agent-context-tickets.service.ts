import { agentContextShaMatches } from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import {
  AGENT_CONTEXT_MAX_TICKETS_PER_AGENT,
  AGENT_CONTEXT_TICKET_IDLE_TTL_MS,
} from '../constants/agent-context.constants';
import type {
  AgentContextAttachmentRef,
  AgentContextEnvironmentRef,
  AgentContextGrants,
  AgentContextStoredItem,
  AgentContextTicketBinding,
  AgentContextTicketRecord,
} from '../types/agent-context.types';

export interface MintAgentContextTicketInput extends AgentContextTicketBinding {
  items: Array<Omit<AgentContextStoredItem, 'index'>>;
  grants?: Partial<AgentContextGrants>;
  attachments?: AgentContextAttachmentRef[];
  workspace?: { mountPath: string; containerType?: string };
  environments?: AgentContextEnvironmentRef[];
}

function normalizeShas(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter((v) => v.length >= 4)));
}

/**
 * Context tickets bind one prompt's context to exactly one agent (and its chat session).
 * The worker MCP server presents the ticket together with the per-agent token; tickets of
 * other agents are indistinguishable from unknown tickets.
 *
 * Process-local store (like {@link VncTicketService}): run a single agent-manager replica
 * or sticky sessions. A lost ticket only degrades to "context unavailable" for that turn.
 */
@Injectable()
export class AgentContextTicketsService {
  private readonly tickets = new Map<string, AgentContextTicketRecord>();
  /** "Allow for this chat" grants, keyed by `${agentId}|${sessionKey}`. */
  private readonly sessionGrants = new Map<string, AgentContextGrants & { lastUsedAt: number }>();

  mint(input: MintAgentContextTicketInput): AgentContextTicketRecord {
    this.purgeExpired();

    const now = Date.now();
    const ticket = `ctx-${randomBytes(18).toString('base64url')}`;
    const record: AgentContextTicketRecord = {
      ticket,
      agentId: input.agentId,
      sessionKey: input.sessionKey,
      socketId: input.socketId,
      chatSessionId: input.chatSessionId,
      chatId: input.chatId,
      ephemeral: input.ephemeral,
      correlationId: input.correlationId,
      accessMode: input.accessMode,
      items: input.items.map((item, i) => ({ ...item, index: i + 1 })),
      grants: {
        ticket: normalizeShas([
          ...(input.grants?.ticket ?? []),
          ...input.items.filter((i) => i.kind === 'ticket' && i.sha).map((i) => i.sha as string),
        ]),
        knowledge: normalizeShas([
          ...(input.grants?.knowledge ?? []),
          ...input.items.filter((i) => i.kind === 'knowledge' && i.sha).map((i) => i.sha as string),
        ]),
      },
      attachments: input.attachments ?? [],
      workspace: input.workspace,
      environments: input.environments ?? [],
      createdAt: now,
      lastUsedAt: now,
    };

    this.tickets.set(ticket, record);
    this.evictOverflow(input.agentId);

    return record;
  }

  /**
   * Resolve a ticket for the authenticated agent. Unknown, expired and foreign tickets all
   * produce the same 404 so tickets cannot be probed across agents.
   */
  resolve(agentId: string, ticket: string): AgentContextTicketRecord {
    this.purgeExpired();

    const record = this.tickets.get(ticket.trim());

    if (!record || record.agentId !== agentId) {
      throw new NotFoundException('Unknown or expired context ticket');
    }

    record.lastUsedAt = Date.now();

    const session = this.sessionGrants.get(this.sessionGrantKey(record.agentId, record.sessionKey));

    if (session) {
      session.lastUsedAt = record.lastUsedAt;
    }

    return record;
  }

  isGranted(record: AgentContextTicketRecord, kind: 'ticket' | 'knowledge', sha: string): boolean {
    const session = this.sessionGrants.get(this.sessionGrantKey(record.agentId, record.sessionKey));
    const pool = [...record.grants[kind], ...(session?.[kind] ?? [])];

    return pool.some((granted) => agentContextShaMatches(granted, sha));
  }

  /** Grant refs for this ticket only (`once`) or for the whole chat session (`session`). */
  grant(
    record: AgentContextTicketRecord,
    refs: Array<{ kind: 'ticket' | 'knowledge'; sha: string }>,
    scope: 'once' | 'session',
  ): void {
    const target: AgentContextGrants =
      scope === 'session' ? this.ensureSessionGrants(record.agentId, record.sessionKey) : record.grants;

    for (const ref of refs) {
      target[ref.kind] = normalizeShas([...target[ref.kind], ref.sha]);
    }
  }

  findItemByIndex(record: AgentContextTicketRecord, index: number): AgentContextStoredItem | undefined {
    return record.items.find((item) => item.index === index);
  }

  findItemBySha(
    record: AgentContextTicketRecord,
    kind: 'ticket' | 'knowledge',
    sha: string,
  ): AgentContextStoredItem | undefined {
    return record.items.find((item) => item.kind === kind && item.sha && agentContextShaMatches(item.sha, sha));
  }

  /** Cache content fetched after an approved access request so repeated reads stay local. */
  rememberItem(record: AgentContextTicketRecord, item: Omit<AgentContextStoredItem, 'index'>): AgentContextStoredItem {
    if (item.sha && (item.kind === 'ticket' || item.kind === 'knowledge')) {
      const existing = this.findItemBySha(record, item.kind, item.sha);

      if (existing) {
        return existing;
      }
    }

    const stored: AgentContextStoredItem = { ...item, index: record.items.length + 1 };

    record.items.push(stored);

    return stored;
  }

  /** Drop every ticket and session grant of an agent (agent deleted / container recreated). */
  revokeAgent(agentId: string): void {
    for (const [key, record] of this.tickets.entries()) {
      if (record.agentId === agentId) {
        this.tickets.delete(key);
      }
    }

    for (const key of this.sessionGrants.keys()) {
      if (key.startsWith(`${agentId}|`)) {
        this.sessionGrants.delete(key);
      }
    }
  }

  private ensureSessionGrants(agentId: string, sessionKey: string): AgentContextGrants {
    const key = this.sessionGrantKey(agentId, sessionKey);
    let grants = this.sessionGrants.get(key);

    if (!grants) {
      grants = { ticket: [], knowledge: [], lastUsedAt: Date.now() };
      this.sessionGrants.set(key, grants);
    }

    return grants;
  }

  private sessionGrantKey(agentId: string, sessionKey: string): string {
    return `${agentId}|${sessionKey}`;
  }

  private evictOverflow(agentId: string): void {
    const own = [...this.tickets.values()]
      .filter((record) => record.agentId === agentId)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

    for (const record of own.slice(0, Math.max(0, own.length - AGENT_CONTEXT_MAX_TICKETS_PER_AGENT))) {
      this.tickets.delete(record.ticket);
    }
  }

  private purgeExpired(): void {
    const cutoff = Date.now() - AGENT_CONTEXT_TICKET_IDLE_TTL_MS;

    for (const [key, record] of this.tickets.entries()) {
      if (record.lastUsedAt < cutoff) {
        this.tickets.delete(key);
      }
    }

    for (const [key, grants] of this.sessionGrants.entries()) {
      if (grants.lastUsedAt < cutoff) {
        this.sessionGrants.delete(key);
      }
    }
  }
}
