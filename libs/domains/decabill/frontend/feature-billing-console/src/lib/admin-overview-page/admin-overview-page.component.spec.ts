import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  AdminOverviewFacade,
  BillingCapabilitiesFacade,
  type AdminOverviewMetrics,
  type AdminOverviewResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { BehaviorSubject } from 'rxjs';

import { AdminOverviewPageComponent } from './admin-overview-page.component';

jest.mock('ng-apexcharts', () => {
  const { Component, Input, NgModule } = jest.requireActual('@angular/core');

  // eslint-disable-next-line @angular-eslint/component-selector -- stands in for ng-apexcharts' own selector
  @Component({ selector: 'apx-chart', standalone: true, template: '' })
  class ChartStubComponent {
    @Input() series: unknown;
    @Input() chart: unknown;
    @Input() colors: unknown;
    @Input() stroke: unknown;
    @Input() fill: unknown;
    @Input() dataLabels: unknown;
    @Input() xaxis: unknown;
    @Input() yaxis: unknown;
    @Input() grid: unknown;
    @Input() legend: unknown;
    @Input() tooltip: unknown;
    @Input() responsive: unknown;
    @Input() labels: unknown;
  }

  @NgModule({ imports: [ChartStubComponent], exports: [ChartStubComponent] })
  class NgApexchartsModule {}

  return { NgApexchartsModule };
});

function metrics(overrides: Partial<AdminOverviewMetrics> = {}): AdminOverviewMetrics {
  return {
    customerCount: 3,
    subscriptionCount: 4,
    activeSubscriptionCount: 2,
    pendingBackorderSubscriptionCount: 0,
    openReceivableCount: 1,
    openReceivableTotal: 119,
    overdueInvoiceCount: 0,
    unbilledTotal: 5,
    revenueInPeriod: 200,
    paidInvoiceCountInPeriod: 1,
    supplierCount: 1,
    openPayableCount: 1,
    openPayableTotal: 50,
    expenseInPeriod: 80,
    draftOfferCount: 1,
    pendingOfferCount: 2,
    pendingOfferTotal: 300,
    acceptedOfferCountInPeriod: 1,
    activeProjectCount: 1,
    openTicketCount: 3,
    articleCount: 4,
    lowStockArticleCount: 1,
    pendingWithdrawalRequestCount: 0,
    openLendingCount: 1,
    overdueLendingCount: 0,
    ...overrides,
  };
}

const series = [
  { period: '2026-11-01', revenueGross: 200, expenseGross: 0 },
  { period: '2026-11-02', revenueGross: 0, expenseGross: 80 },
];

function tenantOverview(tenantId = 'decabill'): AdminOverviewResponse {
  return {
    scope: 'tenant',
    from: '2026-11-01',
    to: '2026-11-02',
    groupBy: 'day',
    tenants: [{ tenantId, metrics: metrics(), series }],
    combined: { metrics: metrics(), series },
  };
}

function allOverview(): AdminOverviewResponse {
  return {
    scope: 'all',
    from: '2026-11-01',
    to: '2026-11-02',
    groupBy: 'day',
    tenants: [
      { tenantId: 'decabill', metrics: metrics(), series },
      { tenantId: 'acme', metrics: metrics({ customerCount: 7, revenueInPeriod: 100 }), series },
    ],
    combined: { metrics: metrics({ customerCount: 10, revenueInPeriod: 300 }), series },
  };
}

describe('AdminOverviewPageComponent', () => {
  let overview$: BehaviorSubject<AdminOverviewResponse | null>;
  let error$: BehaviorSubject<string | null>;
  let loading$: BehaviorSubject<boolean>;
  let globalViewsAllowed$: BehaviorSubject<boolean>;
  let facade: { load: jest.Mock };

  function render() {
    TestBed.configureTestingModule({
      imports: [AdminOverviewPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AdminOverviewFacade,
          useValue: { ...facade, overview$, loading$, error$, params$: new BehaviorSubject(null) },
        },
        {
          provide: BillingCapabilitiesFacade,
          useValue: { globalViewsAllowed$, viewableTenants$: new BehaviorSubject(['decabill', 'acme']) },
        },
        { provide: ENVIRONMENT, useValue: { billing: { tenantId: 'decabill', urls: { restApi: 'http://api' } } } },
      ],
    });

    const fixture = TestBed.createComponent(AdminOverviewPageComponent);

    fixture.detectChanges();

    return { fixture, page: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const originalMatchMedia = window.matchMedia;

  beforeAll(() => {
    // jsdom has no matchMedia (the summary bar watches the viewport).
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  afterAll(() => {
    window.matchMedia = originalMatchMedia;
  });

  beforeEach(() => {
    overview$ = new BehaviorSubject<AdminOverviewResponse | null>(tenantOverview());
    error$ = new BehaviorSubject<string | null>(null);
    loading$ = new BehaviorSubject(false);
    globalViewsAllowed$ = new BehaviorSubject(false);
    facade = { load: jest.fn() };
  });

  it('loads the home tenant with the default 30 day range on init', () => {
    render();

    expect(facade.load).toHaveBeenCalledTimes(1);

    const params = facade.load.mock.calls[0][0];
    const from = new Date(`${params.from}T00:00:00Z`).getTime();
    const to = new Date(`${params.to}T00:00:00Z`).getTime();

    expect(params.viewTenantId).toBeNull();
    expect(params.groupBy).toBe('day');
    expect((to - from) / 86_400_000).toBe(30);
  });

  it('renders the key figures, sections and page links of the home tenant', () => {
    const { el } = render();

    expect(el.querySelector('[data-testid="admin-overview-kpi-customers"]')?.textContent?.trim()).toBe('3');
    expect(el.querySelectorAll('[data-testid^="admin-overview-section-"]')).toHaveLength(6);
    expect(el.querySelector('[data-testid="admin-overview-section-inventory"] a')?.getAttribute('href')).toBe(
      '/administration/inventory',
    );
    expect(el.querySelector('[data-testid="admin-overview-result"]')?.textContent).toContain('120');
    expect(el.querySelector('[data-testid="admin-overview-tenant-switch"]')).toBeNull();
    expect(el.querySelector('[data-testid="admin-overview-tenants-table"]')).toBeNull();
  });

  it('shows the tenant switch with all tenants only with cross-tenant access', () => {
    globalViewsAllowed$.next(true);

    const { page, el } = render();

    expect(el.querySelector('[data-testid="admin-overview-tenant-switch"]')).not.toBeNull();
    expect(page.tenantSwitchOptions().map((o) => o.id)).toEqual(['decabill', 'acme', 'all']);
  });

  it('reloads for the selected tenant and back to the home tenant', () => {
    globalViewsAllowed$.next(true);

    const { page } = render();

    page.onSelectTenant('all');
    expect(facade.load).toHaveBeenLastCalledWith(expect.objectContaining({ viewTenantId: 'all' }));

    page.onSelectTenant('decabill');
    expect(facade.load).toHaveBeenLastCalledWith(expect.objectContaining({ viewTenantId: null }));
    expect(facade.load).toHaveBeenCalledTimes(3);

    // Selecting the active tenant again is a no-op.
    page.onSelectTenant('decabill');
    expect(facade.load).toHaveBeenCalledTimes(3);
  });

  it('hides page links for a foreign tenant', () => {
    globalViewsAllowed$.next(true);
    overview$.next(tenantOverview('acme'));

    const { fixture, page, el } = render();

    page.onSelectTenant('acme');
    fixture.detectChanges();

    expect(page.showPageLinks()).toBe(false);
    expect(el.querySelector('[data-testid="admin-overview-section-inventory"] a')).toBeNull();
  });

  it('shows combined numbers, the tenant revenue chart and the tenant table for all tenants', () => {
    globalViewsAllowed$.next(true);
    overview$.next(allOverview());

    const { page, el } = render();

    expect(el.querySelector('[data-testid="admin-overview-kpi-customers"]')?.textContent?.trim()).toBe('10');
    expect(el.querySelector('[data-testid="admin-overview-tenants-table"]')).not.toBeNull();
    expect(page.tenantRevenueChartOptions()?.series).toEqual([200, 100]);
    expect(page.tenantRows().map((row) => row.tenantId)).toEqual(['decabill', 'acme']);
    expect(page.showPageLinks()).toBe(false);

    const [, acme] = page.tenantRows();

    expect(acme).toBeDefined();
    page.onTenantRowActivate(acme as NonNullable<typeof acme>);
    expect(facade.load).toHaveBeenLastCalledWith(expect.objectContaining({ viewTenantId: 'acme' }));
  });

  it('builds the revenue and expense series chart', () => {
    const { page } = render();
    const chart = page.cashflowChartOptions();

    expect(chart?.series).toEqual([
      { name: 'Revenue', data: [200, 0] },
      { name: 'Expenses', data: [0, 80] },
    ]);
  });

  it('shows the API error without stale figures', () => {
    overview$.next(null);
    error$.next('Cross-tenant admin views are not allowed for this tenant');

    const { el } = render();

    expect(el.querySelector('[data-testid="admin-overview-error"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="admin-overview-panels"]')).toBeNull();
  });

  it('marks a negative result as danger', () => {
    const { page } = render();

    expect(page.resultTone(metrics({ revenueInPeriod: 10, expenseInPeriod: 20 }))).toBe('danger');
    expect(page.resultTone(metrics({ revenueInPeriod: 20, expenseInPeriod: 10 }))).toBe('success');
    expect(page.resultTone(metrics({ revenueInPeriod: 0, expenseInPeriod: 0 }))).toBe('default');
  });
});
