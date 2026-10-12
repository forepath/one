import {
  describeMessageFilterRule,
  evaluateMessageFilters,
  normalizeEffectiveMessageFilters,
  type EffectiveMessageFilterRule,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger } from '@nestjs/common';

import type { FilterResult } from '../providers/chat-filter.interface';
import { AgentsRepository } from '../repositories/agents.repository';

/**
 * Per-agent chat message filter rules (layered agent configuration: global → workspace → environment).
 * Rules arrive with every effective config sync and are cached in memory per agent.
 */
@Injectable()
export class AgentMessageFiltersService {
  private readonly logger = new Logger(AgentMessageFiltersService.name);
  private readonly cache = new Map<string, EffectiveMessageFilterRule[]>();

  constructor(private readonly agentsRepository: AgentsRepository) {}

  /** Persist the effective rules for an agent (normalized; invalid rules are dropped). */
  async store(agentId: string, rules: unknown): Promise<EffectiveMessageFilterRule[]> {
    const normalized = normalizeEffectiveMessageFilters(rules);

    await this.agentsRepository.update(agentId, { messageFilters: normalized });
    this.cache.set(agentId, normalized);

    return normalized;
  }

  invalidate(agentId?: string): void {
    if (agentId) {
      this.cache.delete(agentId);
    } else {
      this.cache.clear();
    }
  }

  async getRules(agentId: string): Promise<EffectiveMessageFilterRule[]> {
    const cached = this.cache.get(agentId);

    if (cached) {
      return cached;
    }

    const agent = await this.agentsRepository.findById(agentId);
    const rules = normalizeEffectiveMessageFilters(agent?.messageFilters ?? []);

    this.cache.set(agentId, rules);

    return rules;
  }

  /** Evaluate a chat message for a gateway direction; most restrictive outcome wins. */
  async evaluate(
    agentId: string | undefined,
    message: string,
    direction: 'incoming' | 'outgoing',
  ): Promise<FilterResult> {
    if (!agentId) {
      return { filtered: false };
    }

    let rules: EffectiveMessageFilterRule[];

    try {
      rules = await this.getRules(agentId);
    } catch (error: unknown) {
      this.logger.warn(`Failed to load message filters for agent ${agentId}: ${(error as Error).message}`);

      return { filtered: false };
    }

    if (rules.length === 0) {
      return { filtered: false };
    }

    const result = evaluateMessageFilters(rules, message, direction);

    if (result.status === 'allowed' || !result.matchedRule) {
      return { filtered: false };
    }

    const reason = describeMessageFilterRule(result.matchedRule);

    if (result.status === 'dropped') {
      return { filtered: true, action: 'drop', reason };
    }

    return result.modifiedMessage !== undefined
      ? { filtered: true, action: 'flag', modifiedMessage: result.modifiedMessage, reason }
      : { filtered: true, action: 'flag', reason };
  }
}
