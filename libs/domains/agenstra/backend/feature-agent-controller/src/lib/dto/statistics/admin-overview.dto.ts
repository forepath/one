import type { StatisticsSummaryDto } from './statistics-summary.dto';

/** Grouping of the overview's period series (same as the audit summary). */
export type AdminOverviewGroupBy = 'day' | 'hour';

/** Figures of one workspace in the admin overview: chat activity of the period plus operational state. */
export interface AdminOverviewWorkspaceMetricsDto {
  /** Agents / users with chat activity in the period. */
  activeAgentCount: number;
  activeUserCount: number;
  totalMessages: number;
  totalTokens: number;
  totalCostUsd: number;
  /** Tickets in to do, in progress or prototype (current state). */
  openTicketCount: number;
  inProgressTicketCount: number;
  knowledgePageCount: number;
  /** CI/CD runs created in the period, and those that ended in failure or timed out. */
  deploymentRunCount: number;
  failedDeploymentRunCount: number;
  /** Autonomous ticket runs started in the period, failed / timed out / escalated ones, and currently pending or running. */
  automationRunCount: number;
  failedAutomationRunCount: number;
  activeAutomationRunCount: number;
  /** Scheduled agent task runs started in the period, and failed ones. */
  taskRunCount: number;
  failedTaskRunCount: number;
}

export interface AdminOverviewWorkspaceDto {
  clientId: string;
  name: string;
  metrics: AdminOverviewWorkspaceMetricsDto;
}

/** Combined figures of the workspaces in scope (sums, distinct active users) plus the audit security totals. */
export interface AdminOverviewMetricsDto extends AdminOverviewWorkspaceMetricsDto {
  workspaceCount: number;
  filterDropCount: number;
  filterFlagCount: number;
  egressBlockedCount: number;
  egressObservedCount: number;
}

export interface AdminOverviewResponseDto {
  /** `all`: every workspace of the instance; `workspace`: the one in `clientId`. */
  scope: 'all' | 'workspace';
  clientId: string | null;
  from: string;
  to: string;
  groupBy: AdminOverviewGroupBy;
  metrics: AdminOverviewMetricsDto;
  /** Messages per period (sparse, as the audit summary). */
  series: NonNullable<StatisticsSummaryDto['series']>;
  /** Filter drops / flags and egress decisions per period (sparse, as the audit summary). */
  securitySeries: NonNullable<StatisticsSummaryDto['securitySeries']>;
  /** One entry per workspace in scope, sorted by messages (most active first). */
  workspaces: AdminOverviewWorkspaceDto[];
}
