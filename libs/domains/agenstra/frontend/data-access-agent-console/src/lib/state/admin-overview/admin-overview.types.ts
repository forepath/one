import type { StatisticsSummaryDto } from '../statistics/statistics.types';

export type AdminOverviewGroupBy = 'day' | 'hour';

/** Query of `GET /admin/overview`. */
export interface AdminOverviewParams {
  /** One workspace; omitted = every workspace (combined). */
  clientId?: string | null;
  from?: string;
  to?: string;
  groupBy?: AdminOverviewGroupBy;
}

/** Figures of one workspace: chat activity of the period plus operational state. */
export interface AdminOverviewWorkspaceMetrics {
  activeAgentCount: number;
  activeUserCount: number;
  totalMessages: number;
  totalTokens: number;
  totalCostUsd: number;
  openTicketCount: number;
  inProgressTicketCount: number;
  knowledgePageCount: number;
  deploymentRunCount: number;
  failedDeploymentRunCount: number;
  automationRunCount: number;
  failedAutomationRunCount: number;
  activeAutomationRunCount: number;
  taskRunCount: number;
  failedTaskRunCount: number;
}

export interface AdminOverviewWorkspace {
  clientId: string;
  name: string;
  metrics: AdminOverviewWorkspaceMetrics;
}

export interface AdminOverviewMetrics extends AdminOverviewWorkspaceMetrics {
  workspaceCount: number;
  filterDropCount: number;
  filterFlagCount: number;
  egressBlockedCount: number;
  egressObservedCount: number;
}

export interface AdminOverviewResponse {
  scope: 'all' | 'workspace';
  clientId: string | null;
  from: string;
  to: string;
  groupBy: AdminOverviewGroupBy;
  metrics: AdminOverviewMetrics;
  series: NonNullable<StatisticsSummaryDto['series']>;
  securitySeries: NonNullable<StatisticsSummaryDto['securitySeries']>;
  workspaces: AdminOverviewWorkspace[];
}
