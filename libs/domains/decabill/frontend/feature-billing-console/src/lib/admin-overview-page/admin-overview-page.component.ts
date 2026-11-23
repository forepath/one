import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ADMIN_OVERVIEW_ALL_TENANTS,
  AdminOverviewFacade,
  BillingCapabilitiesFacade,
  billingTenantDisplayName,
  resolveBillingTenantDisplayName,
  type AdminOverviewGroupBy,
  type AdminOverviewMetrics,
  type AdminOverviewSeriesPoint,
  type AdminOverviewTenant,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT, type Environment } from '@forepath/decabill/frontend/util-configuration';
import {
  FpcAlertComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcKeyValueListComponent,
  FpcListToolbarComponent,
  fpcListQueryState,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  FPC_CHART_AREA_FILL,
  FPC_CHART_GRID,
  FPC_CHART_LEGEND,
  FPC_CHART_LEGEND_SCROLL,
  FPC_CHART_LINE_STROKE,
  FPC_CHART_SLICE_LABELS,
  FPC_CHART_SLICE_TOOLTIP,
  fpcChart,
  fpcChartCategorical,
  fpcChartColor,
  fpcChartValueAxis,
  type FpcKeyValueItem,
  type FpcSummaryCardTone,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis,
} from 'ng-apexcharts';
import { NgApexchartsModule } from 'ng-apexcharts';
import { filter, map, take, withLatestFrom } from 'rxjs';

import { BILLING_CHART_RESPONSIVE, billingChartTimeAxis } from '../billing-chart';
import { formatBillingDateRange, formatBillingMoney } from '../billing-format';
import { BillingTenantSwitchComponent, type BillingTenantSwitchOption } from '../shared/tenant-switch.component';
import { ThemeService } from '../theme.service';

/** One row of the per-tenant comparison table (all tenants view). */
interface AdminOverviewTenantRow {
  id: string;
  tenantId: string;
  label: string;
  metrics: AdminOverviewMetrics;
}

/** One area panel of the overview (customers, receivables, …) with its facts and console page. */
interface AdminOverviewSection {
  id: string;
  title: string;
  link: string;
  items: FpcKeyValueItem[];
}

const DEFAULT_RANGE_DAYS = 30;

/**
 * Admin overview (dashboard): the key figures of the tenant across customers, receivables, payables, offers,
 * projects and inventory, plus revenue and expenses of a period. Laid out like Agenstra's audit overview (summary bar,
 * filter strip, panel grid of charts). Tenants with cross-tenant access (TENANTS_ALLOW_GLOBAL_VIEWS) switch to another
 * tenant or to "All tenants" (combined numbers plus a per-tenant comparison) with the header tenant chip; they start on
 * "All tenants".
 */
@Component({
  selector: 'framework-admin-overview-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    NgApexchartsModule,
    BillingTenantSwitchComponent,
    FpcAlertComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcKeyValueListComponent,
    FpcListToolbarComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
  ],
  providers: [DatePipe],
  templateUrl: './admin-overview-page.component.html',
  styleUrls: ['./admin-overview-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOverviewPageComponent implements OnInit {
  private readonly facade = inject(AdminOverviewFacade);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly themeService = inject(ThemeService);
  private readonly datePipe = inject(DatePipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureAdminOverview-title:Overview`;
  readonly filtersPanelTitle = $localize`:@@featureAdminOverview-filtersTitle:Overview filters`;
  readonly loadingLabel = $localize`:@@featureAdminOverview-loading:Loading overview…`;
  readonly customersLabel = $localize`:@@featureAdminOverview-kpiCustomers:Customers`;
  readonly activeSubscriptionsLabel = $localize`:@@featureAdminOverview-kpiActiveSubscriptions:Active subscriptions`;
  readonly revenueLabel = $localize`:@@featureAdminOverview-kpiRevenue:Revenue in period`;
  readonly expensesLabel = $localize`:@@featureAdminOverview-kpiExpenses:Expenses in period`;
  readonly receivablesLabel = $localize`:@@featureAdminOverview-kpiReceivables:Open receivables`;
  readonly payablesLabel = $localize`:@@featureAdminOverview-kpiPayables:Open payables`;
  readonly cashflowChartTitle = $localize`:@@featureAdminOverview-chartCashflow:Revenue and expenses`;
  readonly resultChartTitle = $localize`:@@featureAdminOverview-chartResult:Result in period`;
  readonly tenantRevenueChartTitle = $localize`:@@featureAdminOverview-chartTenantRevenue:Revenue by tenant`;
  readonly tenantsTableTitle = $localize`:@@featureAdminOverview-tenantsTable:Tenants`;
  readonly openLabel = $localize`:@@featureAdminOverview-openPage:Open`;
  readonly allTenantsLabel = $localize`:@@featureAdminOverview-allTenants:All tenants`;
  private readonly revenueSeriesLabel = $localize`:@@featureAdminOverview-seriesRevenue:Revenue`;
  private readonly expenseSeriesLabel = $localize`:@@featureAdminOverview-seriesExpenses:Expenses`;
  private readonly homeNote = $localize`:@@featureAdminOverview-homeTenant:Home tenant`;
  private readonly allNote = $localize`:@@featureAdminOverview-allTenantsNote:Combined numbers of all tenants`;

  readonly homeTenantId = this.environment.billing?.tenantId?.trim() || 'default';
  private readonly homeTenantLabel = resolveBillingTenantDisplayName(this.environment);

  readonly overview = toSignal(this.facade.overview$, { initialValue: null });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null as string | null });
  private readonly globalViewsAllowed = toSignal(this.capabilities.globalViewsAllowed$, { initialValue: false });
  private readonly viewableTenants = toSignal(this.capabilities.viewableTenants$, { initialValue: [] as string[] });

  /**
   * Viewed tenant: `null` = the home tenant, a tenant id, or {@link ADMIN_OVERVIEW_ALL_TENANTS} (the start view when
   * global views are allowed).
   */
  readonly viewTenantId = signal<string | null>(null);
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly groupBy = signal<AdminOverviewGroupBy>('day');
  readonly filtersOpen = signal(false);
  private readonly defaultDates = signal({ from: '', to: '' });
  /** Applied range and grouping in the URL (`?f=`); the strip edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { from: this.fromDate, to: this.toDate, groupBy: this.groupBy },
    open: this.filtersOpen,
    changed: () => this.load(),
    defaults: () => this.defaultDates(),
  });
  readonly activeFilterCount = computed(() => {
    const applied = this.filterState.applied();
    const defaults = this.defaultDates();

    return [applied.from !== defaults.from || applied.to !== defaults.to, applied.groupBy !== 'day'].filter(Boolean)
      .length;
  });

  readonly tenantSwitchVisible = computed(() => this.globalViewsAllowed() === true);
  readonly tenantSwitchOptions = computed<BillingTenantSwitchOption[]>(() => {
    const viewable = this.viewableTenants() ?? [];
    const tenants = viewable.includes(this.homeTenantId) ? viewable : [this.homeTenantId, ...viewable];

    return [
      ...tenants.map((tenantId) => ({
        id: tenantId,
        label: this.tenantLabel(tenantId),
        description: tenantId === this.homeTenantId ? this.homeNote : undefined,
      })),
      { id: ADMIN_OVERVIEW_ALL_TENANTS, label: this.allTenantsLabel, icon: 'buildings', description: this.allNote },
    ];
  });
  readonly activeTenantSwitchId = computed(() => this.viewTenantId() ?? this.homeTenantId);
  /** Links to the console pages only make sense for the home tenant (those pages show the home tenant). */
  readonly showPageLinks = computed(() => this.overview()?.tenants.length === 1 && !this.isForeignTenant());
  readonly isAllTenants = computed(() => this.overview()?.scope === 'all');
  readonly metrics = computed(() => this.overview()?.combined.metrics ?? null);
  readonly scopeLabel = computed(() => {
    const applied = this.filterState.applied();
    const range = formatBillingDateRange(applied.from || null, applied.to || null);
    const grouping =
      applied.groupBy === 'month'
        ? $localize`:@@featureAdminOverview-scopeByMonth:by month`
        : $localize`:@@featureAdminOverview-scopeByDay:by day`;

    return `${range}, ${grouping}`;
  });

  readonly sections = computed<AdminOverviewSection[]>(() => {
    const m = this.metrics();

    return m ? this.buildSections(m) : [];
  });
  readonly cashflowChartOptions = computed(() => this.buildCashflowChart(this.overview()?.combined.series ?? []));
  readonly tenantRevenueChartOptions = computed(() =>
    this.isAllTenants() ? this.buildTenantRevenueChart(this.overview()?.tenants ?? []) : null,
  );
  readonly tenantRows = computed<AdminOverviewTenantRow[]>(() =>
    (this.overview()?.tenants ?? []).map((tenant) => ({
      id: tenant.tenantId,
      tenantId: tenant.tenantId,
      label: this.tenantLabel(tenant.tenantId),
      metrics: tenant.metrics,
    })),
  );
  readonly tenantColumns: FpcTableColumn<AdminOverviewTenantRow>[] = [
    {
      id: 'tenant',
      label: $localize`:@@featureAdminOverview-colTenant:Tenant`,
      value: (row) => row.label,
      required: true,
    },
    {
      id: 'customers',
      label: this.customersLabel,
      value: (row) => row.metrics.customerCount,
      align: 'end',
    },
    {
      id: 'activeSubscriptions',
      label: this.activeSubscriptionsLabel,
      value: (row) => row.metrics.activeSubscriptionCount,
      align: 'end',
    },
    {
      id: 'revenue',
      label: this.revenueLabel,
      value: (row) => formatBillingMoney(row.metrics.revenueInPeriod),
      align: 'end',
    },
    {
      id: 'expenses',
      label: this.expensesLabel,
      value: (row) => formatBillingMoney(row.metrics.expenseInPeriod),
      align: 'end',
      priority: 3,
    },
    {
      id: 'receivables',
      label: this.receivablesLabel,
      value: (row) => formatBillingMoney(row.metrics.openReceivableTotal),
      align: 'end',
    },
    {
      id: 'payables',
      label: this.payablesLabel,
      value: (row) => formatBillingMoney(row.metrics.openPayableTotal),
      align: 'end',
      priority: 3,
    },
  ];

  ngOnInit(): void {
    this.setDefaultDates();
    // The start view depends on the capabilities (global views): refresh them and load once they are settled. A failed
    // request settles too and falls back to the home tenant.
    this.capabilities.loadCapabilities();
    this.capabilities.loading$
      .pipe(
        filter((loading) => !loading),
        take(1),
        withLatestFrom(this.capabilities.globalViewsAllowed$),
        map(([, globalViewsAllowed]) => globalViewsAllowed === true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((globalViewsAllowed) => {
        if (globalViewsAllowed) this.viewTenantId.set(ADMIN_OVERVIEW_ALL_TENANTS);

        this.load();
      });
  }

  tenantLabel(tenantId: string): string {
    if (tenantId === ADMIN_OVERVIEW_ALL_TENANTS) return this.allTenantsLabel;

    if (tenantId === this.homeTenantId) return this.homeTenantLabel;

    return billingTenantDisplayName(tenantId);
  }

  money(value: number | null | undefined): string {
    return formatBillingMoney(value ?? 0);
  }

  resultTone(m: AdminOverviewMetrics): FpcSummaryCardTone {
    const result = m.revenueInPeriod - m.expenseInPeriod;

    if (result > 0) return 'success';

    if (result < 0) return 'danger';

    return 'default';
  }

  onSelectTenant(tenantId: string): void {
    if (!tenantId || tenantId === this.activeTenantSwitchId()) return;

    this.viewTenantId.set(tenantId === this.homeTenantId ? null : tenantId);
    this.load();
  }

  onTenantRowActivate(row: AdminOverviewTenantRow): void {
    this.onSelectTenant(row.tenantId);
  }

  onFiltersOpenChange(open: boolean): void {
    this.filtersOpen.set(open);
  }

  onResetFilters(): void {
    this.filterState.clear();
  }

  readonly tenantRowId = (row: AdminOverviewTenantRow): string => row.id;

  private isForeignTenant(): boolean {
    const viewed = this.viewTenantId();

    return viewed !== null && viewed !== this.homeTenantId;
  }

  private load(): void {
    this.facade.load({
      viewTenantId: this.viewTenantId(),
      from: this.fromDate() || undefined,
      to: this.toDate() || undefined,
      groupBy: this.groupBy(),
    });
  }

  private setDefaultDates(): void {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    from.setUTCDate(from.getUTCDate() - DEFAULT_RANGE_DAYS);
    const defaults = { from: from.toISOString().slice(0, 10), to };

    this.defaultDates.set(defaults);

    // A range from the URL (`?f=`) wins over the defaults.
    if (!this.fromDate()) this.fromDate.set(defaults.from);

    if (!this.toDate()) this.toDate.set(defaults.to);
  }

  private buildSections(m: AdminOverviewMetrics): AdminOverviewSection[] {
    const count = (value: number) => String(value);

    return [
      {
        id: 'customers',
        title: $localize`:@@featureAdminOverview-sectionCustomers:Customers and subscriptions`,
        link: '/administration/customer-profiles',
        items: [
          { key: 'customers', label: this.customersLabel, value: count(m.customerCount) },
          {
            key: 'subscriptions',
            label: $localize`:@@featureAdminOverview-subscriptions:Subscriptions`,
            value: count(m.subscriptionCount),
          },
          { key: 'activeSubscriptions', label: this.activeSubscriptionsLabel, value: count(m.activeSubscriptionCount) },
          {
            key: 'backorders',
            label: $localize`:@@featureAdminOverview-backorders:Waiting for capacity`,
            value: count(m.pendingBackorderSubscriptionCount),
          },
        ],
      },
      {
        id: 'receivables',
        title: $localize`:@@featureAdminOverview-sectionReceivables:Receivables`,
        link: '/administration/billing',
        items: [
          {
            key: 'openReceivables',
            label: this.receivablesLabel,
            value: this.money(m.openReceivableTotal),
            hint: $localize`:@@featureAdminOverview-openInvoicesHint:${m.openReceivableCount}:count: open invoices`,
          },
          {
            key: 'overdue',
            label: $localize`:@@featureAdminOverview-overdueInvoices:Overdue invoices`,
            value: count(m.overdueInvoiceCount),
          },
          {
            key: 'unbilled',
            label: $localize`:@@featureAdminOverview-unbilled:Not yet billed`,
            value: this.money(m.unbilledTotal),
          },
          {
            key: 'revenue',
            label: this.revenueLabel,
            value: this.money(m.revenueInPeriod),
            hint: $localize`:@@featureAdminOverview-paidInvoicesHint:${m.paidInvoiceCountInPeriod}:count: paid invoices`,
          },
        ],
      },
      {
        id: 'payables',
        title: $localize`:@@featureAdminOverview-sectionPayables:Payables`,
        link: '/administration/supplier-profiles',
        items: [
          {
            key: 'suppliers',
            label: $localize`:@@featureAdminOverview-suppliers:Suppliers`,
            value: count(m.supplierCount),
          },
          {
            key: 'openPayables',
            label: this.payablesLabel,
            value: this.money(m.openPayableTotal),
            hint: $localize`:@@featureAdminOverview-openSupplierInvoicesHint:${m.openPayableCount}:count: open supplier invoices`,
          },
          { key: 'expenses', label: this.expensesLabel, value: this.money(m.expenseInPeriod) },
        ],
      },
      {
        id: 'offers',
        title: $localize`:@@featureAdminOverview-sectionOffers:Offers`,
        link: '/administration/offers',
        items: [
          {
            key: 'pendingOffers',
            label: $localize`:@@featureAdminOverview-pendingOffers:Awaiting response`,
            value: count(m.pendingOfferCount),
            hint: this.money(m.pendingOfferTotal),
          },
          {
            key: 'draftOffers',
            label: $localize`:@@featureAdminOverview-draftOffers:Drafts`,
            value: count(m.draftOfferCount),
          },
          {
            key: 'acceptedOffers',
            label: $localize`:@@featureAdminOverview-acceptedOffers:Accepted in period`,
            value: count(m.acceptedOfferCountInPeriod),
          },
        ],
      },
      {
        id: 'projects',
        title: $localize`:@@featureAdminOverview-sectionProjects:Projects`,
        link: '/administration/projects',
        items: [
          {
            key: 'activeProjects',
            label: $localize`:@@featureAdminOverview-activeProjects:Active projects`,
            value: count(m.activeProjectCount),
          },
          {
            key: 'openTickets',
            label: $localize`:@@featureAdminOverview-openTickets:Open tickets`,
            value: count(m.openTicketCount),
          },
        ],
      },
      {
        id: 'inventory',
        title: $localize`:@@featureAdminOverview-sectionInventory:Inventory`,
        link: '/administration/inventory',
        items: [
          {
            key: 'articles',
            label: $localize`:@@featureAdminOverview-articles:Articles`,
            value: count(m.articleCount),
          },
          {
            key: 'lowStock',
            label: $localize`:@@featureAdminOverview-lowStock:Low stock`,
            value: count(m.lowStockArticleCount),
          },
          {
            key: 'requests',
            label: $localize`:@@featureAdminOverview-pendingRequests:Pending withdrawal requests`,
            value: count(m.pendingWithdrawalRequestCount),
          },
          {
            key: 'lendings',
            label: $localize`:@@featureAdminOverview-openLendings:Open lendings`,
            value: count(m.openLendingCount),
            hint:
              m.overdueLendingCount > 0
                ? $localize`:@@featureAdminOverview-overdueLendingsHint:${m.overdueLendingCount}:count: overdue`
                : null,
          },
        ],
      },
    ];
  }

  private buildCashflowChart(series: AdminOverviewSeriesPoint[]) {
    if (series.length === 0) return null;

    return {
      series: [
        { name: this.revenueSeriesLabel, data: series.map((p) => p.revenueGross) },
        { name: this.expenseSeriesLabel, data: series.map((p) => p.expenseGross) },
      ] as ApexAxisChartSeries,
      chart: fpcChart('area', 260) as ApexChart,
      colors: [fpcChartColor(0), fpcChartColor(1)],
      stroke: FPC_CHART_LINE_STROKE as ApexStroke,
      fill: FPC_CHART_AREA_FILL as ApexFill,
      dataLabels: { enabled: false } as ApexDataLabels,
      xaxis: billingChartTimeAxis(series.map((p) => this.formatPeriodLabel(p.period))) as ApexXAxis,
      yaxis: fpcChartValueAxis((value) => formatBillingMoney(value, undefined, { compact: true })) as ApexYAxis,
      grid: FPC_CHART_GRID,
      legend: { ...FPC_CHART_LEGEND, position: 'top', horizontalAlign: 'left' } as ApexLegend,
      tooltip: { y: { formatter: (value: number) => formatBillingMoney(value) } } as ApexTooltip,
      responsive: BILLING_CHART_RESPONSIVE,
    };
  }

  private buildTenantRevenueChart(tenants: AdminOverviewTenant[]) {
    const items = tenants.filter((tenant) => tenant.metrics.revenueInPeriod > 0);

    if (items.length === 0) return null;

    return {
      series: items.map((tenant) => tenant.metrics.revenueInPeriod) as ApexNonAxisChartSeries,
      chart: fpcChart('donut', 260) as ApexChart,
      labels: items.map((tenant) => this.tenantLabel(tenant.tenantId)),
      colors: fpcChartCategorical(items.length, this.themeService.isDarkMode()),
      dataLabels: {
        ...FPC_CHART_SLICE_LABELS,
        enabled: true,
        formatter: (percent: number) => `${percent.toFixed(1)}%`,
        style: { ...FPC_CHART_SLICE_LABELS.style, fontSize: '10px' },
      } as ApexDataLabels,
      legend: FPC_CHART_LEGEND_SCROLL as ApexLegend,
      responsive: BILLING_CHART_RESPONSIVE,
      tooltip: {
        ...FPC_CHART_SLICE_TOOLTIP,
        y: { formatter: (value: number) => formatBillingMoney(value) },
      } as ApexTooltip,
    };
  }

  /** Period keys are calendar dates (UTC); short axis labels, the year sits in the range filter. */
  private formatPeriodLabel(period: string): string {
    const format = this.groupBy() === 'month' ? 'MMM y' : 'MMM d';

    return this.datePipe.transform(`${period}T12:00:00.000Z`, format, 'UTC') ?? period;
  }
}
