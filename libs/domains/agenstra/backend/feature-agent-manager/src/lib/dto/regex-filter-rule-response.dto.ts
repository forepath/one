import type { RegexFilterRuleDirection, RegexFilterRuleType } from '../entities/regex-filter-rule.entity';

/**
 * API response for a regex filter rule.
 */
export class RegexFilterRuleResponseDto {
  id!: string;
  pattern!: string;
  regexFlags!: string;
  direction!: RegexFilterRuleDirection;
  filterType!: RegexFilterRuleType;
  replaceContent?: string | null;
  priority!: number;
  createdAt!: string;
  updatedAt!: string;
}
