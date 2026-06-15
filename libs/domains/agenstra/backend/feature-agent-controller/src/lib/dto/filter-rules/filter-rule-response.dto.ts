import type { FilterRuleSyncStatus } from '../../entities/agent-console-regex-filter-rule-sync-target.entity';
import type {
  ConsoleRegexFilterDirection,
  ConsoleRegexFilterType,
} from '../../entities/agent-console-regex-filter-rule.entity';

export class FilterRuleSyncSummaryDto {
  pending!: number;
  synced!: number;
  failed!: number;
}

/** Per-workspace agent-manager sync state for a filter rule. */
export class FilterRuleWorkspaceSyncDto {
  clientId!: string;
  syncStatus!: FilterRuleSyncStatus;
  lastError?: string | null;
}

export class FilterRuleResponseDto {
  id!: string;
  pattern!: string;
  regexFlags!: string;
  direction!: ConsoleRegexFilterDirection;
  filterType!: ConsoleRegexFilterType;
  replaceContent?: string | null;
  priority!: number;
  enabled!: boolean;
  isGlobal!: boolean;
  workspaceIds!: string[];
  sync!: FilterRuleSyncSummaryDto;
  /** One entry per workspace sync target (global and scoped rules). */
  workspaceSync!: FilterRuleWorkspaceSyncDto[];
  createdAt!: string;
  updatedAt!: string;
}
