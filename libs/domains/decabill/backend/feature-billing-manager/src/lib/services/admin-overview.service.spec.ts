import { getTenantIdOrDefault, runWithTenantId } from '@forepath/shared/backend';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { OfferStatus } from '../offers/constants/offer-status.constants';
import { ProjectStatus, ProjectTicketStatus } from '../projects/entities/project.enums';

import { ADMIN_OVERVIEW_ALL_TENANTS, AdminOverviewService } from './admin-overview.service';

/** Per-tenant fixture values; every mock reads the tenant of its async context, like the real repositories. */
const FIXTURES: Record<string, { customers: number; revenue: number; expense: number; unbilled: number }> = {
  default: { customers: 3, revenue: 100.1, expense: 40, unbilled: 5.5 },
  acme: { customers: 7, revenue: 50.2, expense: 10, unbilled: 1 },
};

function tenantFixture() {
  return FIXTURES[getTenantIdOrDefault()] ?? { customers: 0, revenue: 0, expense: 0, unbilled: 0 };
}

describe('AdminOverviewService', () => {
  const globalViews = { isGlobalViewsAllowedForTenant: jest.fn() };
  const tenants = { getConfiguredTenants: jest.fn(), isValidTenant: jest.fn() };
  const seenTenants: string[] = [];
  const billingAdminService = {
    getGlobalSummary: jest.fn(async () => {
      seenTenants.push(getTenantIdOrDefault());

      return {
        subscriptionsCount: 4,
        activeSubscriptionsCount: 2,
        openOverdueCount: 1,
        openOverdueTotal: 19.99,
        unbilledTotal: tenantFixture().unbilled,
      };
    }),
  };
  const invoicesRepository = {
    countByStatus: jest.fn(async () => 1),
    sumPaidGrossByPeriod: jest.fn(async (_from: Date, _to: Date, groupBy: string) => [
      { period: groupBy === 'month' ? '2026-11-01' : '2026-11-02', totalGross: tenantFixture().revenue },
    ]),
    countPaidInPeriod: jest.fn(async () => 2),
  };
  const subscriptionsRepository = { countByStatus: jest.fn(async () => 1) };
  const customerProfilesRepository = {
    findAll: jest.fn(async () => ({ items: [], total: tenantFixture().customers })),
  };
  const supplierProfilesRepository = { findAll: jest.fn(async () => ({ items: [], total: 2 })) };
  const supplierInvoicesRepository = {
    summaryStats: jest.fn(async () => ({ openCount: 1, openGross: 30, paidCount: 0, paidGross: 0, draftCount: 0 })),
    sumExpenseGrossByPeriod: jest.fn(async (_from: Date, _to: Date, groupBy: string) => [
      { period: groupBy === 'month' ? '2026-11-01' : '2026-11-03', totalGross: tenantFixture().expense },
    ]),
  };
  const offersRepository = {
    countByStatus: jest.fn(async (status: OfferStatus) => (status === OfferStatus.DRAFT ? 2 : 3)),
    sumGrossByStatus: jest.fn(async () => 300),
    countByTimestampField: jest.fn(async () => 1),
  };
  const projectsRepository = { countByStatus: jest.fn(async () => 2) };
  const projectTicketsRepository = { countByStatus: jest.fn(async (_status: ProjectTicketStatus) => 4) };
  const inventoryArticlesService = {
    summary: jest.fn(async () => ({
      warehouseCount: 1,
      compartmentCount: 2,
      articleCount: 10,
      lowStockArticleCount: 1,
      pendingRequestCount: 2,
      openLendingCount: 3,
      overdueLendingCount: 1,
    })),
  };
  const service = new AdminOverviewService(
    globalViews as never,
    tenants as never,
    billingAdminService as never,
    invoicesRepository as never,
    subscriptionsRepository as never,
    customerProfilesRepository as never,
    supplierProfilesRepository as never,
    supplierInvoicesRepository as never,
    offersRepository as never,
    projectsRepository as never,
    projectTicketsRepository as never,
    inventoryArticlesService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    seenTenants.length = 0;
    globalViews.isGlobalViewsAllowedForTenant.mockReturnValue(false);
    tenants.getConfiguredTenants.mockReturnValue(['default', 'acme']);
    tenants.isValidTenant.mockImplementation((id: string) => ['default', 'acme'].includes(id));
  });

  it('returns the request tenant figures by default', async () => {
    const result = await runWithTenantId('default', () =>
      service.getOverview({ from: '2026-11-01', to: '2026-11-03' }),
    );

    expect(result.scope).toBe('tenant');
    expect(result.tenants.map((t) => t.tenantId)).toEqual(['default']);
    expect(seenTenants).toEqual(['default']);
    expect(result.from).toBe('2026-11-01');
    expect(result.to).toBe('2026-11-03');
    expect(result.groupBy).toBe('day');
    expect(result.combined.metrics).toEqual(result.tenants[0]?.metrics);
    expect(result.tenants[0]?.metrics).toEqual({
      customerCount: 3,
      subscriptionCount: 4,
      activeSubscriptionCount: 2,
      pendingBackorderSubscriptionCount: 1,
      openReceivableCount: 1,
      openReceivableTotal: 19.99,
      overdueInvoiceCount: 1,
      unbilledTotal: 5.5,
      revenueInPeriod: 100.1,
      paidInvoiceCountInPeriod: 2,
      supplierCount: 2,
      openPayableCount: 1,
      openPayableTotal: 30,
      expenseInPeriod: 40,
      draftOfferCount: 2,
      pendingOfferCount: 3,
      pendingOfferTotal: 300,
      acceptedOfferCountInPeriod: 1,
      activeProjectCount: 2,
      openTicketCount: 12,
      articleCount: 10,
      lowStockArticleCount: 1,
      pendingWithdrawalRequestCount: 2,
      openLendingCount: 3,
      overdueLendingCount: 1,
    });
    expect(result.tenants[0]?.series).toEqual([
      { period: '2026-11-01', revenueGross: 0, expenseGross: 0 },
      { period: '2026-11-02', revenueGross: 100.1, expenseGross: 0 },
      { period: '2026-11-03', revenueGross: 0, expenseGross: 40 },
    ]);
    expect(subscriptionsRepository.countByStatus).toHaveBeenCalledWith(SubscriptionStatus.PENDING_BACKORDER);
    expect(invoicesRepository.countByStatus).toHaveBeenCalledWith(InvoiceStatus.OVERDUE);
    expect(offersRepository.countByStatus).toHaveBeenCalledWith(OfferStatus.ARCHIVED);
    expect(projectsRepository.countByStatus).toHaveBeenCalledWith(ProjectStatus.ACTIVE);
    expect(projectTicketsRepository.countByStatus.mock.calls.map(([status]) => status)).toEqual([
      ProjectTicketStatus.TODO,
      ProjectTicketStatus.IN_PROGRESS,
      ProjectTicketStatus.PROTOTYPE,
    ]);
  });

  it('treats viewTenantId equal to the request tenant as the own tenant without global access', async () => {
    const result = await runWithTenantId('acme', () => service.getOverview({ viewTenantId: 'acme' }));

    expect(result.tenants.map((t) => t.tenantId)).toEqual(['acme']);
    expect(seenTenants).toEqual(['acme']);
  });

  it('rejects a foreign tenant without global access', async () => {
    await expect(runWithTenantId('acme', () => service.getOverview({ viewTenantId: 'default' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(billingAdminService.getGlobalSummary).not.toHaveBeenCalled();
  });

  it('rejects all tenants without global access', async () => {
    await expect(
      runWithTenantId('acme', () => service.getOverview({ viewTenantId: ADMIN_OVERVIEW_ALL_TENANTS })),
    ).rejects.toThrow(ForbiddenException);
    expect(billingAdminService.getGlobalSummary).not.toHaveBeenCalled();
  });

  it('runs the queries of a foreign tenant in that tenant context with global access', async () => {
    globalViews.isGlobalViewsAllowedForTenant.mockReturnValue(true);

    const result = await runWithTenantId('default', () => service.getOverview({ viewTenantId: 'acme' }));

    expect(result.scope).toBe('tenant');
    expect(result.tenants.map((t) => t.tenantId)).toEqual(['acme']);
    expect(seenTenants).toEqual(['acme']);
    expect(result.tenants[0]?.metrics.customerCount).toBe(7);
  });

  it('rejects an unknown foreign tenant with global access', async () => {
    globalViews.isGlobalViewsAllowedForTenant.mockReturnValue(true);

    await expect(runWithTenantId('default', () => service.getOverview({ viewTenantId: 'ghost' }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('returns every configured tenant and the combined sums for all tenants', async () => {
    globalViews.isGlobalViewsAllowedForTenant.mockReturnValue(true);

    const result = await runWithTenantId('default', () =>
      service.getOverview({
        viewTenantId: ADMIN_OVERVIEW_ALL_TENANTS,
        from: '2026-10-15',
        to: '2026-11-20',
        groupBy: 'month',
      }),
    );

    expect(result.scope).toBe('all');
    expect(result.tenants.map((t) => t.tenantId)).toEqual(['default', 'acme']);
    expect(seenTenants).toEqual(['default', 'acme']);
    expect(result.combined.metrics.customerCount).toBe(10);
    expect(result.combined.metrics.unbilledTotal).toBe(6.5);
    expect(result.combined.metrics.revenueInPeriod).toBe(150.3);
    expect(result.combined.metrics.expenseInPeriod).toBe(50);
    expect(result.combined.metrics.openTicketCount).toBe(24);
    expect(result.combined.series).toEqual([
      { period: '2026-10-01', revenueGross: 0, expenseGross: 0 },
      { period: '2026-11-01', revenueGross: 150.3, expenseGross: 50 },
    ]);
  });

  it('includes the request tenant in all tenants even when it is not configured', async () => {
    globalViews.isGlobalViewsAllowedForTenant.mockReturnValue(true);
    tenants.getConfiguredTenants.mockReturnValue(['acme']);

    const result = await runWithTenantId('default', () =>
      service.getOverview({ viewTenantId: ADMIN_OVERVIEW_ALL_TENANTS }),
    );

    expect(result.tenants.map((t) => t.tenantId)).toEqual(['default', 'acme']);
  });

  it.each([
    [{ groupBy: 'week' }, 'Invalid groupBy'],
    [{ from: '2026-11-05', to: '2026-11-01' }, 'from must be before to'],
    [{ from: '2026-1-5', to: '2026-11-01' }, 'expected YYYY-MM-DD'],
    [{ from: '2026-02-30', to: '2026-03-01' }, 'Invalid date range'],
    [{ from: "2026-01-01' OR 1=1", to: '2026-03-01' }, 'expected YYYY-MM-DD'],
    [{ from: '2024-01-01', to: '2026-01-01', groupBy: 'day' }, 'at most 366 days'],
    [{ from: '2000-01-01', to: '2026-01-01', groupBy: 'month' }, 'at most 3660 days'],
  ])('rejects invalid ranges %o', async (query, message) => {
    await expect(runWithTenantId('default', () => service.getOverview(query))).rejects.toThrow(message);
    expect(billingAdminService.getGlobalSummary).not.toHaveBeenCalled();
  });

  it('accepts a full year grouped by month', async () => {
    const result = await runWithTenantId('default', () =>
      service.getOverview({ from: '2026-01-01', to: '2026-12-31', groupBy: 'month' }),
    );

    expect(result.combined.series).toHaveLength(12);
  });
});
