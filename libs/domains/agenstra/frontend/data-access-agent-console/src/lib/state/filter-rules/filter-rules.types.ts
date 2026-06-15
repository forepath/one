export type FilterRuleDirection = 'incoming' | 'outgoing' | 'bidirectional';
export type FilterRuleType = 'none' | 'filter' | 'drop';

export interface ListFilterRulesParams {
  limit?: number;
  offset?: number;
}

export interface FilterRuleSyncSummary {
  pending: number;
  synced: number;
  failed: number;
}

export type FilterRuleWorkspaceSyncStatus = 'pending' | 'synced' | 'failed';

export interface FilterRuleWorkspaceSyncDto {
  clientId: string;
  syncStatus: FilterRuleWorkspaceSyncStatus;
  lastError?: string | null;
}

export interface FilterRuleResponseDto {
  id: string;
  pattern: string;
  regexFlags: string;
  direction: FilterRuleDirection;
  filterType: FilterRuleType;
  replaceContent?: string | null;
  priority: number;
  enabled: boolean;
  isGlobal: boolean;
  workspaceIds: string[];
  sync: FilterRuleSyncSummary;
  /** Per-workspace sync row (same order as agent-controller). */
  workspaceSync: FilterRuleWorkspaceSyncDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateFilterRuleDto {
  pattern: string;
  regexFlags?: string;
  direction: FilterRuleDirection;
  filterType: FilterRuleType;
  replaceContent?: string;
  priority?: number;
  enabled?: boolean;
  isGlobal: boolean;
  workspaceIds?: string[];
}

export interface UpdateFilterRuleDto {
  pattern?: string;
  regexFlags?: string;
  direction?: FilterRuleDirection;
  filterType?: FilterRuleType;
  replaceContent?: string | null;
  priority?: number;
  enabled?: boolean;
  isGlobal?: boolean;
  workspaceIds?: string[];
}
