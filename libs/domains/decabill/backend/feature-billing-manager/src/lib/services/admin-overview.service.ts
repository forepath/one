import { getTenantIdOrDefault, runWithTenantId } from '@forepath/shared/backend';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import type {
  AdminOverviewGroupBy,
  AdminOverviewMetricsDto,
  AdminOverviewResponseDto,
  AdminOverviewSeriesPointDto,
  AdminOverviewTenantDto,
} from '../dto/admin-overview.dto';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { InventoryArticlesService } from '../inventory/services/inventory-articles.service';
import { OfferStatus } from '../offers/constants/offer-status.constants';
import { OffersRepository } from '../offers/repositories/offers.repository';
import { ProjectStatus, ProjectTicketStatus } from '../projects/entities/project.enums';
import { ProjectTicketsRepository } from '../projects/repositories/project-tickets.repository';
import { ProjectsRepository } from '../projects/repositories/projects.repository';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { SupplierInvoicesRepository } from '../repositories/supplier-invoices.repository';
import { SupplierProfilesRepository } from '../repositories/supplier-profiles.repository';
import { resolveAdminViewTenant } from '../utils/admin-view-tenant.util';
import { fillMeterHistoryPeriodSeries } from '../utils/meter-history-date.util';

import { BillingAdminService } from './billing-admin.service';
import { BillingTenantService } from './billing-tenant.service';
import { TenantsGlobalViewsConfigService } from './tenants-global-views-config.service';

/** `viewTenantId` value of the cross-tenant view (every configured tenant plus the combined numbers). */
export const ADMIN_OVERVIEW_ALL_TENANTS = 'all';

/** Longest allowed range per grouping, so a request cannot build unbounded series (DoS). */
const MAX_RANGE_DAYS: Record<AdminOverviewGroupBy, number> = { day: 366, month: 3660 };
const DEFAULT_RANGE_DAYS = 30;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ticket states that still need work (not draft, done or closed). */
const OPEN_TICKET_STATUSES: ProjectTicketStatus[] = [
  ProjectTicketStatus.TODO,
  ProjectTicketStatus.IN_PROGRESS,
  ProjectTicketStatus.PROTOTYPE,
];
const METRIC_KEYS: (keyof AdminOverviewMetricsDto)[] = [
  'customerCount',
  'subscriptionCount',
  'activeSubscriptionCount',
  'pendingBackorderSubscriptionCount',
  'openReceivableCount',
  'openReceivableTotal',
  'overdueInvoiceCount',
  'unbilledTotal',
  'revenueInPeriod',
  'paidInvoiceCountInPeriod',
  'supplierCount',
  'openPayableCount',
  'openPayableTotal',
  'expenseInPeriod',
  'draftOfferCount',
  'pendingOfferCount',
  'pendingOfferTotal',
  'acceptedOfferCountInPeriod',
  'activeProjectCount',
  'openTicketCount',
  'articleCount',
  'lowStockArticleCount',
  'pendingWithdrawalRequestCount',
  'openLendingCount',
  'overdueLendingCount',
];

export interface AdminOverviewQuery {
  viewTenantId?: string;
  from?: string;
  to?: string;
  groupBy?: string;
}

interface OverviewRange {
  from: Date;
  to: Date;
  fromKey: string;
  toKey: string;
  groupBy: AdminOverviewGroupBy;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Admin overview (dashboard) of the key figures of a tenant. Tenants on TENANTS_ALLOW_GLOBAL_VIEWS may view another
 * configured tenant or `all` (every configured tenant plus combined sums). Each tenant's figures come from the
 * regular tenant-scoped repositories run inside that tenant's context, so no query bypasses the tenant filters.
 */
@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly globalViews: TenantsGlobalViewsConfigService,
    private readonly tenants: BillingTenantService,
    private readonly billingAdminService: BillingAdminService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly supplierProfilesRepository: SupplierProfilesRepository,
    private readonly supplierInvoicesRepository: SupplierInvoicesRepository,
    private readonly offersRepository: OffersRepository,
    private readonly projectsRepository: ProjectsRepository,
    private readonly projectTicketsRepository: ProjectTicketsRepository,
    private readonly inventoryArticlesService: InventoryArticlesService,
  ) {}

  async getOverview(query: AdminOverviewQuery): Promise<AdminOverviewResponseDto> {
    const { scope, tenantIds } = this.resolveTenants(query.viewTenantId);
    const range = this.parseRange(query.from, query.to, query.groupBy);
    const tenants: AdminOverviewTenantDto[] = [];

    // Sequential on purpose: one tenant at a time keeps the DB pool free for regular traffic.
    for (const tenantId of tenantIds) {
      tenants.push(await runWithTenantId(tenantId, () => this.buildTenant(tenantId, range)));
    }

    return {
      scope,
      from: range.fromKey,
      to: range.toKey,
      groupBy: range.groupBy,
      tenants,
      combined: this.combine(tenants, range),
    };
  }

  private resolveTenants(viewTenantId?: string): { scope: 'tenant' | 'all'; tenantIds: string[] } {
    const requestTenantId = getTenantIdOrDefault();
    const requested = viewTenantId?.trim();

    if (requested === ADMIN_OVERVIEW_ALL_TENANTS) {
      if (!this.globalViews.isGlobalViewsAllowedForTenant(requestTenantId)) {
        throw new ForbiddenException('Cross-tenant admin views are not allowed for this tenant');
      }

      const configured = this.tenants.getConfiguredTenants();
      const tenantIds = configured.includes(requestTenantId) ? [...configured] : [requestTenantId, ...configured];

      return { scope: 'all', tenantIds };
    }

    const tenantId = resolveAdminViewTenant(this.globalViews, requested);

    if (tenantId !== requestTenantId && !this.tenants.isValidTenant(tenantId)) {
      throw new BadRequestException('Unknown tenant');
    }

    return { scope: 'tenant', tenantIds: [tenantId] };
  }

  private parseRange(from?: string, to?: string, groupBy?: string): OverviewRange {
    if (groupBy != null && groupBy !== 'day' && groupBy !== 'month') {
      throw new BadRequestException('Invalid groupBy: expected day or month');
    }

    const grouping: AdminOverviewGroupBy = groupBy === 'month' ? 'month' : 'day';
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    const fromKey = from?.trim() || defaultFrom.toISOString().slice(0, 10);
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

    return { from: fromDate, to: toDate, fromKey, toKey, groupBy: grouping };
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

  /** Figures of the tenant of the current async context (see `runWithTenantId` in {@link getOverview}). */
  private async buildTenant(tenantId: string, range: OverviewRange): Promise<AdminOverviewTenantDto> {
    const [
      billingSummary,
      pendingBackorderSubscriptionCount,
      overdueInvoiceCount,
      revenueSeries,
      paidInvoiceCountInPeriod,
      customers,
      suppliers,
      payables,
      expenseSeries,
      draftOfferCount,
      pendingOfferCount,
      pendingOfferTotal,
      acceptedOfferCountInPeriod,
      activeProjectCount,
      openTicketCounts,
      inventory,
    ] = await Promise.all([
      this.billingAdminService.getGlobalSummary(),
      this.subscriptionsRepository.countByStatus(SubscriptionStatus.PENDING_BACKORDER),
      this.invoicesRepository.countByStatus(InvoiceStatus.OVERDUE),
      this.invoicesRepository.sumPaidGrossByPeriod(range.from, range.to, range.groupBy),
      this.invoicesRepository.countPaidInPeriod(range.from, range.to),
      this.customerProfilesRepository.findAll(1, 0),
      this.supplierProfilesRepository.findAll(1, 0),
      this.supplierInvoicesRepository.summaryStats(),
      this.supplierInvoicesRepository.sumExpenseGrossByPeriod(range.from, range.to, range.groupBy),
      this.offersRepository.countByStatus(OfferStatus.DRAFT),
      this.offersRepository.countByStatus(OfferStatus.ARCHIVED),
      this.offersRepository.sumGrossByStatus(OfferStatus.ARCHIVED),
      this.offersRepository.countByTimestampField({ field: 'accepted_at', from: range.from, to: range.to }),
      this.projectsRepository.countByStatus(ProjectStatus.ACTIVE),
      Promise.all(OPEN_TICKET_STATUSES.map((status) => this.projectTicketsRepository.countByStatus(status))),
      this.inventoryArticlesService.summary(),
    ]);
    const revenueInPeriod = revenueSeries.reduce((sum, point) => sum + point.totalGross, 0);
    const expenseInPeriod = expenseSeries.reduce((sum, point) => sum + point.totalGross, 0);
    const metrics: AdminOverviewMetricsDto = {
      customerCount: customers.total,
      subscriptionCount: billingSummary.subscriptionsCount,
      activeSubscriptionCount: billingSummary.activeSubscriptionsCount,
      pendingBackorderSubscriptionCount,
      openReceivableCount: billingSummary.openOverdueCount,
      openReceivableTotal: roundMoney(billingSummary.openOverdueTotal),
      overdueInvoiceCount,
      unbilledTotal: roundMoney(billingSummary.unbilledTotal),
      revenueInPeriod: roundMoney(revenueInPeriod),
      paidInvoiceCountInPeriod,
      supplierCount: suppliers.total,
      openPayableCount: payables.openCount,
      openPayableTotal: roundMoney(payables.openGross),
      expenseInPeriod: roundMoney(expenseInPeriod),
      draftOfferCount,
      pendingOfferCount,
      pendingOfferTotal: roundMoney(pendingOfferTotal),
      acceptedOfferCountInPeriod,
      activeProjectCount,
      openTicketCount: openTicketCounts.reduce((sum, count) => sum + count, 0),
      articleCount: inventory.articleCount,
      lowStockArticleCount: inventory.lowStockArticleCount,
      pendingWithdrawalRequestCount: inventory.pendingRequestCount,
      openLendingCount: inventory.openLendingCount,
      overdueLendingCount: inventory.overdueLendingCount,
    };

    return { tenantId, metrics, series: this.mergeSeries(revenueSeries, expenseSeries, range) };
  }

  private mergeSeries(
    revenue: { period: string; totalGross: number }[],
    expenses: { period: string; totalGross: number }[],
    range: OverviewRange,
  ): AdminOverviewSeriesPointDto[] {
    const byPeriod = new Map<string, AdminOverviewSeriesPointDto>();
    const point = (period: string) => {
      const key = period.slice(0, 10);
      let entry = byPeriod.get(key);

      if (!entry) {
        entry = { period: key, revenueGross: 0, expenseGross: 0 };
        byPeriod.set(key, entry);
      }

      return entry;
    };

    for (const row of revenue) point(row.period).revenueGross += row.totalGross;

    for (const row of expenses) point(row.period).expenseGross += row.totalGross;

    const sparse = [...byPeriod.values()].map((entry) => ({
      period: entry.period,
      revenueGross: roundMoney(entry.revenueGross),
      expenseGross: roundMoney(entry.expenseGross),
    }));

    return fillMeterHistoryPeriodSeries(sparse, range.fromKey, range.toKey, range.groupBy, (period) => ({
      period,
      revenueGross: 0,
      expenseGross: 0,
    }));
  }

  private combine(tenants: AdminOverviewTenantDto[], range: OverviewRange): AdminOverviewResponseDto['combined'] {
    const metrics = Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as unknown as AdminOverviewMetricsDto;

    for (const tenant of tenants) {
      for (const key of METRIC_KEYS) metrics[key] += tenant.metrics[key];
    }

    for (const key of METRIC_KEYS) metrics[key] = roundMoney(metrics[key]);

    const revenue = tenants.flatMap((tenant) =>
      tenant.series.map((p) => ({ period: p.period, totalGross: p.revenueGross })),
    );
    const expenses = tenants.flatMap((tenant) =>
      tenant.series.map((p) => ({ period: p.period, totalGross: p.expenseGross })),
    );

    return { metrics, series: this.mergeSeries(revenue, expenses, range) };
  }
}
