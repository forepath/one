import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import type {
  AdminOverviewGroupBy,
  AdminOverviewMetricsDto,
  AdminOverviewResponseDto,
  AdminOverviewWorkspaceDto,
  AdminOverviewWorkspaceMetricsDto,
} from '../dto/statistics/admin-overview.dto';
import { AdminOverviewRepository, EMPTY_WORKSPACE_COUNTS } from '../repositories/admin-overview.repository';
import { ClientsRepository } from '../repositories/clients.repository';
import { StatisticsRepository } from '../repositories/statistics.repository';

import { StatisticsQueryService } from './statistics-query.service';

/** Longest allowed range per grouping, so a request cannot build unbounded series (DoS). */
const MAX_RANGE_DAYS: Record<AdminOverviewGroupBy, number> = { day: 366, hour: 31 };
const DEFAULT_RANGE_DAYS = 30;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Sum keys of the per-workspace metrics; `activeUserCount` is distinct across workspaces and counted separately. */
const SUM_KEYS: (keyof AdminOverviewWorkspaceMetricsDto)[] = [
  'activeAgentCount',
  'totalMessages',
  'totalTokens',
  'totalCostUsd',
  'openTicketCount',
  'inProgressTicketCount',
  'knowledgePageCount',
  'deploymentRunCount',
  'failedDeploymentRunCount',
  'automationRunCount',
  'failedAutomationRunCount',
  'activeAutomationRunCount',
  'taskRunCount',
  'failedTaskRunCount',
];

export interface AdminOverviewQuery {
  clientId?: string;
  from?: string;
  to?: string;
  groupBy?: string;
}

interface OverviewRange {
  /** `YYYY-MM-DD` as requested / defaulted. */
  fromKey: string;
  toKey: string;
  /** Inclusive ISO bounds of the period. */
  from: string;
  to: string;
  groupBy: AdminOverviewGroupBy;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Admin overview (dashboard) of the Agenstra instance: chat activity, tickets, knowledge, CI/CD and automation runs
 * and security events, combined over the workspaces in scope and per workspace. The caller passes the workspaces it
 * may see (`ClientsService.getAccessibleClientIds`); an optional `clientId` narrows the scope to one of them.
 */
@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly statisticsQueryService: StatisticsQueryService,
    private readonly statisticsRepository: StatisticsRepository,
    private readonly overviewRepository: AdminOverviewRepository,
    private readonly clientsRepository: ClientsRepository,
  ) {}

  async getOverview(accessibleClientIds: string[], query: AdminOverviewQuery): Promise<AdminOverviewResponseDto> {
    const range = this.parseRange(query.from, query.to, query.groupBy);
    const clientId = query.clientId?.trim() || null;

    if (clientId && !accessibleClientIds.includes(clientId)) {
      throw new ForbiddenException('You do not have access to this client');
    }

    const scopeIds = clientId ? [clientId] : accessibleClientIds;
    const period = { from: range.from, to: range.to };
    const [summary, chatByClient, countsByClient, activeUserCount, clients] = await Promise.all([
      this.statisticsQueryService.getSummary(scopeIds, {
        from: range.fromKey,
        to: range.toKey,
        groupBy: range.groupBy,
      }),
      this.statisticsRepository.queryChatIoByClient({ originalClientIds: scopeIds, ...period }),
      this.overviewRepository.countByWorkspace(scopeIds, period),
      this.statisticsRepository.countActiveChatUsers({ originalClientIds: scopeIds, ...period }),
      this.clientsRepository.findByIdsOrdered(scopeIds),
    ]);
    const workspaces: AdminOverviewWorkspaceDto[] = clients.map((client) => {
      const chat = chatByClient.get(client.id);
      const counts = countsByClient.get(client.id) ?? EMPTY_WORKSPACE_COUNTS;

      return {
        clientId: client.id,
        name: client.name,
        metrics: {
          activeAgentCount: chat?.activeAgents ?? 0,
          activeUserCount: chat?.activeUsers ?? 0,
          totalMessages: chat?.totalMessages ?? 0,
          totalTokens: chat?.totalTokens ?? 0,
          totalCostUsd: roundUsd(chat?.totalCostUsd ?? 0),
          ...counts,
        },
      };
    });

    workspaces.sort((a, b) => b.metrics.totalMessages - a.metrics.totalMessages || a.name.localeCompare(b.name));

    const metrics = Object.fromEntries(SUM_KEYS.map((key) => [key, 0])) as unknown as AdminOverviewMetricsDto;

    for (const workspace of workspaces) {
      for (const key of SUM_KEYS) metrics[key] += workspace.metrics[key];
    }

    return {
      scope: clientId ? 'workspace' : 'all',
      clientId,
      from: range.fromKey,
      to: range.toKey,
      groupBy: range.groupBy,
      metrics: {
        ...metrics,
        totalCostUsd: roundUsd(metrics.totalCostUsd),
        activeUserCount,
        workspaceCount: workspaces.length,
        filterDropCount: summary.filterDropCount,
        filterFlagCount: summary.filterFlagCount,
        egressBlockedCount: summary.egressBlockedCount,
        egressObservedCount: summary.egressObservedCount,
      },
      series: summary.series ?? [],
      securitySeries: summary.securitySeries ?? [],
      workspaces,
    };
  }

  private parseRange(from?: string, to?: string, groupBy?: string): OverviewRange {
    if (groupBy != null && groupBy !== 'day' && groupBy !== 'hour') {
      throw new BadRequestException('Invalid groupBy: expected day or hour');
    }

    const grouping: AdminOverviewGroupBy = groupBy === 'hour' ? 'hour' : 'day';
    const now = new Date();
    const fromKey = from?.trim() || new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS).toISOString().slice(0, 10);
    const toKey = to?.trim() || now.toISOString().slice(0, 10);
    const fromDate = this.parseDateBoundary(fromKey, 'start');
    const toDate = this.parseDateBoundary(toKey, 'end');

    if (fromDate > toDate) {
      throw new BadRequestException('Invalid date range: from must be before to');
    }

    if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_DAYS[grouping] * DAY_MS) {
      throw new BadRequestException(
        `Invalid date range: at most ${MAX_RANGE_DAYS[grouping]} days when grouped by ${grouping}`,
      );
    }

    return { fromKey, toKey, from: fromDate.toISOString(), to: toDate.toISOString(), groupBy: grouping };
  }

  private parseDateBoundary(value: string, boundary: 'start' | 'end'): Date {
    if (!DATE_ONLY.test(value)) {
      throw new BadRequestException('Invalid date range: expected YYYY-MM-DD');
    }

    const date = new Date(`${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`);

    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Invalid date range');
    }

    return date;
  }
}
