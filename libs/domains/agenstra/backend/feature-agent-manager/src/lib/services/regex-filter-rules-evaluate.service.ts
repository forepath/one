import { Injectable } from '@nestjs/common';

import { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';
import { FilterDirection, FilterResult } from '../providers/chat-filter.interface';
import {
  applyReplace,
  compileRegexOrThrow,
  normalizeRegexFlags,
  ruleMatchesMessage,
} from '../utils/regex-filter-rule.utils';

import { RegexFilterRulesCacheService } from './regex-filter-rules-cache.service';

/**
 * Evaluates DB regex rules for a gateway direction (first match wins).
 */
@Injectable()
export class RegexFilterRulesEvaluateService {
  constructor(private readonly cache: RegexFilterRulesCacheService) {}

  private appliesToGatewayDirection(rule: RegexFilterRuleEntity, gatewayDirection: FilterDirection): boolean {
    if (rule.direction === 'bidirectional') {
      return true;
    }

    if (gatewayDirection === FilterDirection.INCOMING) {
      return rule.direction === 'incoming';
    }

    if (gatewayDirection === FilterDirection.OUTGOING) {
      return rule.direction === 'outgoing';
    }

    return false;
  }

  /**
   * Returns first matching rule outcome, or not filtered.
   */
  async evaluate(message: string, gatewayDirection: FilterDirection): Promise<FilterResult> {
    const rules = await this.cache.getAllOrdered();

    for (const rule of rules) {
      if (!this.appliesToGatewayDirection(rule, gatewayDirection)) {
        continue;
      }

      try {
        const flags = normalizeRegexFlags(rule.regexFlags);

        compileRegexOrThrow(rule.pattern, flags);

        if (!ruleMatchesMessage(rule, message)) {
          continue;
        }

        if (rule.filterType === 'drop') {
          return { filtered: true, action: 'drop', reason: `Regex rule ${rule.id}` };
        }

        if (rule.filterType === 'none') {
          return { filtered: true, action: 'flag', reason: 'Regex rule matched (none)' };
        }

        if (rule.filterType === 'filter') {
          const modified = applyReplace(rule, message);

          return {
            filtered: true,
            action: 'flag',
            modifiedMessage: modified,
            reason: 'Regex rule replaced content',
          };
        }
      } catch {
        // Skip invalid rules at runtime rather than failing chat
        continue;
      }
    }

    return { filtered: false };
  }
}
