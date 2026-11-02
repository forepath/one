/** Filter types breakdown item */
export interface StatisticsFilterTypesBreakdownItem {
  filterType: string;
  /** Human-readable rule name (as on the filter rows); `null` / missing for legacy rows. */
  filterDisplayName?: string | null;
  direction: 'incoming' | 'outgoing';
  count: number;
}

/** Time series point for summary */
export interface StatisticsSeriesPoint {
  period: string;
  count: number;
  wordCount: number;
  charCount: number;
}

/** Summary response from statistics API */
export interface StatisticsSummaryDto {
  totalMessages: number;
  totalWords: number;
  totalChars: number;
  avgWordsPerMessage: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  filterDropCount: number;
  filterTypesBreakdown: StatisticsFilterTypesBreakdownItem[];
  filterFlagCount: number;
  filterFlagsBreakdown: StatisticsFilterTypesBreakdownItem[];
  series?: StatisticsSeriesPoint[];
  /** Egress guard decisions (sum of aggregated counts) by decision. */
  egressAllowedCount?: number;
  egressBlockedCount?: number;
  egressObservedCount?: number;
  egressGuardErrorCount?: number;
  egressBreakdown?: StatisticsEgressBreakdownItem[];
  egressTopBlockedHosts?: Array<{ host: string; count: number }>;
  egressRulesBreakdown?: Array<{ rule: string; count: number }>;
  /** Security events over time (with groupBy). */
  securitySeries?: StatisticsSecuritySeriesPoint[];
}

export type StatisticsEgressKind = 'web' | 'dns' | 'network' | 'guard';
export type StatisticsEgressDecision = 'allowed' | 'blocked' | 'observed' | 'error';

export interface StatisticsEgressBreakdownItem {
  kind: StatisticsEgressKind;
  decision: StatisticsEgressDecision;
  count: number;
}

export interface StatisticsSecuritySeriesPoint {
  period: string;
  filterDrops: number;
  filterFlags: number;
  egressAllowed: number;
  egressBlocked: number;
  egressObserved: number;
}

/** Single egress guard decision (aggregate of identical decisions within one collection cycle). */
export interface StatisticsEgressEventDto {
  id: string;
  clientId: string;
  agentId?: string;
  clientName?: string;
  agentName?: string;
  kind: StatisticsEgressKind;
  decision: StatisticsEgressDecision;
  host?: string | null;
  rule?: string | null;
  matchedEntry?: string | null;
  matchedSource?: string | null;
  method?: string | null;
  httpStatus?: number | null;
  sampleUrl?: string | null;
  count: number;
  bytesIn: number;
  bytesOut: number;
  mode?: string | null;
  policyRevision?: string | null;
  message?: string | null;
  firstSeenAt: string;
  occurredAt: string;
}

/** Paginated egress events list */
export interface StatisticsEgressEventListDto {
  data: StatisticsEgressEventDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Single chat I/O record */
export interface StatisticsChatIoDto {
  id: string;
  clientId: string;
  agentId?: string;
  clientName?: string;
  agentName?: string;
  originalUserId?: string;
  direction: 'input' | 'output';
  wordCount: number;
  charCount: number;
  occurredAt: string;
}

/** Paginated chat I/O list */
export interface StatisticsChatIoListDto {
  data: StatisticsChatIoDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Single filter drop record */
export interface StatisticsFilterDropDto {
  id: string;
  clientId: string;
  agentId?: string;
  clientName?: string;
  agentName?: string;
  originalUserId?: string;
  filterType: string;
  filterDisplayName: string;
  filterReason?: string;
  direction: 'incoming' | 'outgoing';
  wordCount: number;
  charCount: number;
  occurredAt: string;
}

/** Paginated filter drops list */
export interface StatisticsFilterDropListDto {
  data: StatisticsFilterDropDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Single filter flag record (message flagged/modified but not dropped) */
export interface StatisticsFilterFlagDto {
  id: string;
  clientId: string;
  agentId?: string;
  clientName?: string;
  agentName?: string;
  originalUserId?: string;
  filterType: string;
  filterDisplayName: string;
  filterReason?: string;
  direction: 'incoming' | 'outgoing';
  wordCount: number;
  charCount: number;
  occurredAt: string;
}

/** Paginated filter flags list */
export interface StatisticsFilterFlagListDto {
  data: StatisticsFilterFlagDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Entity type for statistics events */
export type StatisticsEntityType = 'user' | 'client' | 'agent' | 'client_user' | 'provisioning_reference';

/** Entity event type */
export type StatisticsEntityEventType = 'created' | 'updated' | 'deleted';

/** Single entity event record */
export interface StatisticsEntityEventDto {
  id: string;
  entityType: StatisticsEntityType;
  eventType: StatisticsEntityEventType;
  originalEntityId: string;
  originalUserId?: string;
  clientId?: string;
  agentId?: string;
  clientName?: string;
  agentName?: string;
  occurredAt: string;
}

/** Paginated entity events list */
export interface StatisticsEntityEventListDto {
  data: StatisticsEntityEventDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Query params for statistics endpoints */
export interface StatisticsQueryParams {
  from?: string;
  to?: string;
  groupBy?: 'day' | 'hour';
  agentId?: string;
  filterType?: string;
  entityType?: StatisticsEntityType;
  eventType?: StatisticsEntityEventType;
  direction?: 'input' | 'output';
  kind?: StatisticsEgressKind;
  decision?: StatisticsEgressDecision;
  search?: string;
  limit?: number;
  offset?: number;
}

/** Params for client-scoped requests (clientId from path) */
export interface StatisticsClientScopeParams extends StatisticsQueryParams {
  clientId: string;
}

/** Params for aggregate requests (optional clientId filter) */
export interface StatisticsAggregateParams extends StatisticsQueryParams {
  clientId?: string;
}
