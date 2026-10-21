import type { AgentContextAccessDecision } from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import {
  AGENT_CONTEXT_ACCESS_REQUEST_ID_PREFIX,
  AGENT_CONTEXT_ACCESS_REQUEST_TTL_MS,
} from '../constants/agent-context.constants';

export type AgentContextAccessReply = 'once' | 'always' | 'reject';

export interface AgentContextAccessRequestRecord {
  id: string;
  agentId: string;
  ticket: string;
  refs: Array<{ kind: 'ticket' | 'knowledge'; sha: string }>;
  reason?: string;
  decision: AgentContextAccessDecision;
  reply?: AgentContextAccessReply;
  createdAt: number;
}

interface PendingWaiter {
  resolve: (record: AgentContextAccessRequestRecord) => void;
}

/**
 * Pending "may I read more context?" requests raised by the worker MCP server.
 * Interactive decisions arrive through the permission reply endpoint (ids start with `ctx_`).
 */
@Injectable()
export class AgentContextAccessService {
  private readonly requests = new Map<string, AgentContextAccessRequestRecord>();
  private readonly waiters = new Map<string, PendingWaiter[]>();

  static isAccessRequestId(id: string): boolean {
    return id.startsWith(AGENT_CONTEXT_ACCESS_REQUEST_ID_PREFIX);
  }

  create(
    input: Omit<AgentContextAccessRequestRecord, 'id' | 'decision' | 'createdAt'>,
  ): AgentContextAccessRequestRecord {
    this.purgeExpired();

    const record: AgentContextAccessRequestRecord = {
      ...input,
      id: `${AGENT_CONTEXT_ACCESS_REQUEST_ID_PREFIX}${randomBytes(12).toString('hex')}`,
      decision: 'pending',
      createdAt: Date.now(),
    };

    this.requests.set(record.id, record);

    return record;
  }

  get(agentId: string, id: string): AgentContextAccessRequestRecord {
    this.purgeExpired();

    const record = this.requests.get(id);

    if (!record || record.agentId !== agentId) {
      throw new NotFoundException('Unknown or expired context access request');
    }

    return record;
  }

  /** Apply a decision once; later replies (e.g. a second console tab) are ignored. */
  decide(agentId: string, id: string, reply: AgentContextAccessReply): AgentContextAccessRequestRecord {
    const record = this.get(agentId, id);

    if (record.decision !== 'pending') {
      return record;
    }

    record.decision = reply === 'reject' ? 'denied' : 'granted';
    record.reply = reply;

    const waiters = this.waiters.get(id) ?? [];

    this.waiters.delete(id);

    for (const waiter of waiters) {
      waiter.resolve(record);
    }

    return record;
  }

  /** Wait up to `timeoutMs` for a decision; resolves with the (possibly still pending) record. */
  waitForDecision(agentId: string, id: string, timeoutMs: number): Promise<AgentContextAccessRequestRecord> {
    const record = this.get(agentId, id);

    if (record.decision !== 'pending') {
      return Promise.resolve(record);
    }

    return new Promise((resolve) => {
      const waiter: PendingWaiter = {
        resolve: (decided) => {
          clearTimeout(timer);
          resolve(decided);
        },
      };
      const timer = setTimeout(() => {
        const list = this.waiters.get(id) ?? [];

        this.waiters.set(
          id,
          list.filter((entry) => entry !== waiter),
        );
        resolve(record);
      }, timeoutMs);

      timer.unref?.();
      this.waiters.set(id, [...(this.waiters.get(id) ?? []), waiter]);
    });
  }

  private purgeExpired(): void {
    const cutoff = Date.now() - AGENT_CONTEXT_ACCESS_REQUEST_TTL_MS;

    for (const [id, record] of this.requests.entries()) {
      if (record.createdAt >= cutoff) {
        continue;
      }

      this.requests.delete(id);

      for (const waiter of this.waiters.get(id) ?? []) {
        waiter.resolve({ ...record, decision: record.decision === 'pending' ? 'denied' : record.decision });
      }

      this.waiters.delete(id);
    }
  }
}
