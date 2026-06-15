/** Filter types breakdown item */
export interface StatisticsFilterTypesBreakdownItem {
  filterType: string;
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
  filterDropCount: number;
  filterTypesBreakdown: StatisticsFilterTypesBreakdownItem[];
  filterFlagCount: number;
  filterFlagsBreakdown: StatisticsFilterTypesBreakdownItem[];
  series?: StatisticsSeriesPoint[];
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
