import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { EMPTY_WORKSPACE_COUNTS } from '../repositories/admin-overview.repository';

import { AdminOverviewService } from './admin-overview.service';

describe('AdminOverviewService', () => {
  const summary = {
    totalMessages: 15,
    filterDropCount: 2,
    filterFlagCount: 3,
    egressBlockedCount: 4,
    egressObservedCount: 5,
    series: [{ period: '2026-11-02T00:00:00.000Z', count: 15, wordCount: 0, charCount: 0 }],
    securitySeries: [
      {
        period: '2026-11-02T00:00:00.000Z',
        filterDrops: 2,
        filterFlags: 3,
        egressAllowed: 0,
        egressBlocked: 4,
        egressObserved: 5,
      },
    ],
  };
  let statisticsQueryService: { getSummary: jest.Mock };
  let statisticsRepository: { queryChatIoByClient: jest.Mock; countActiveChatUsers: jest.Mock };
  let overviewRepository: { countByWorkspace: jest.Mock };
  let clientsRepository: { findByIdsOrdered: jest.Mock };
  let service: AdminOverviewService;

  beforeEach(() => {
    statisticsQueryService = { getSummary: jest.fn().mockResolvedValue(summary) };
    statisticsRepository = {
      queryChatIoByClient: jest.fn().mockResolvedValue(
        new Map([
          ['c1', { totalMessages: 10, totalTokens: 100, totalCostUsd: 0.1, activeAgents: 2, activeUsers: 2 }],
          ['c2', { totalMessages: 5, totalTokens: 50, totalCostUsd: 0.2, activeAgents: 1, activeUsers: 1 }],
        ]),
      ),
      countActiveChatUsers: jest.fn().mockResolvedValue(2),
    };
    overviewRepository = {
      countByWorkspace: jest
        .fn()
        .mockResolvedValue(
          new Map([
            [
              'c1',
              { ...EMPTY_WORKSPACE_COUNTS, openTicketCount: 3, deploymentRunCount: 2, failedDeploymentRunCount: 1 },
            ],
          ]),
        ),
    };
    clientsRepository = {
      findByIdsOrdered: jest.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, name: id === 'c1' ? 'Alpha' : id === 'c2' ? 'Beta' : 'Gamma' })),
      ),
    };
    service = new AdminOverviewService(
      statisticsQueryService as never,
      statisticsRepository as never,
      overviewRepository as never,
      clientsRepository as never,
    );
  });

  it('combines every accessible workspace', async () => {
    const result = await service.getOverview(['c2', 'c1', 'c3'], { from: '2026-11-01', to: '2026-11-03' });

    expect(result.scope).toBe('all');
    expect(result.clientId).toBeNull();
    expect(result.workspaces.map((w) => w.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(result.workspaces[2]?.metrics).toEqual({
      ...EMPTY_WORKSPACE_COUNTS,
      activeAgentCount: 0,
      activeUserCount: 0,
      totalMessages: 0,
      totalTokens: 0,
      totalCostUsd: 0,
    });
    expect(result.metrics).toEqual(
      expect.objectContaining({
        workspaceCount: 3,
        activeAgentCount: 3,
        // Distinct across workspaces, not the sum of the per-workspace counts.
        activeUserCount: 2,
        totalMessages: 15,
        totalTokens: 150,
        totalCostUsd: 0.3,
        openTicketCount: 3,
        deploymentRunCount: 2,
        failedDeploymentRunCount: 1,
        filterDropCount: 2,
        filterFlagCount: 3,
        egressBlockedCount: 4,
        egressObservedCount: 5,
      }),
    );
    expect(result.series).toEqual(summary.series);
    expect(result.securitySeries).toEqual(summary.securitySeries);
    expect(statisticsQueryService.getSummary).toHaveBeenCalledWith(['c2', 'c1', 'c3'], {
      from: '2026-11-01',
      to: '2026-11-03',
      groupBy: 'day',
    });
    expect(overviewRepository.countByWorkspace).toHaveBeenCalledWith(['c2', 'c1', 'c3'], {
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-03T23:59:59.999Z',
    });
  });

  it('narrows the scope to one accessible workspace', async () => {
    const result = await service.getOverview(['c1', 'c2'], {
      clientId: 'c2',
      groupBy: 'hour',
      from: '2026-11-01',
      to: '2026-11-02',
    });

    expect(result.scope).toBe('workspace');
    expect(result.clientId).toBe('c2');
    expect(statisticsQueryService.getSummary).toHaveBeenCalledWith(
      ['c2'],
      expect.objectContaining({ groupBy: 'hour' }),
    );
    expect(statisticsRepository.queryChatIoByClient).toHaveBeenCalledWith(
      expect.objectContaining({ originalClientIds: ['c2'] }),
    );
  });

  it('rejects a workspace outside the accessible ones', async () => {
    await expect(service.getOverview(['c1'], { clientId: 'c2' })).rejects.toThrow(ForbiddenException);
    expect(statisticsQueryService.getSummary).not.toHaveBeenCalled();
  });

  it('defaults to the last 30 days grouped by day', async () => {
    const result = await service.getOverview([], {});
    const days = (Date.parse(result.to) - Date.parse(result.from)) / 86_400_000;

    expect(result.groupBy).toBe('day');
    expect(days).toBe(30);
    expect(result.metrics.workspaceCount).toBe(0);
  });

  it.each([
    [{ groupBy: 'month' }, 'Invalid groupBy'],
    [{ from: '2026-11-05', to: '2026-11-01' }, 'from must be before to'],
    [{ from: '2026-11-5' }, 'expected YYYY-MM-DD'],
    [{ from: '2026-02-30', to: '2026-03-01' }, 'Invalid date range'],
    [{ from: "2026-01-01' OR 1=1", to: '2026-03-01' }, 'expected YYYY-MM-DD'],
    [{ from: '2025-01-01', to: '2026-03-01' }, 'at most 366 days'],
    [{ from: '2026-10-01', to: '2026-11-15', groupBy: 'hour' }, 'at most 31 days'],
  ])('rejects invalid ranges %o', async (query, message) => {
    await expect(service.getOverview(['c1'], query)).rejects.toThrow(BadRequestException);
    await expect(service.getOverview(['c1'], query)).rejects.toThrow(message);
    expect(statisticsQueryService.getSummary).not.toHaveBeenCalled();
  });
});
