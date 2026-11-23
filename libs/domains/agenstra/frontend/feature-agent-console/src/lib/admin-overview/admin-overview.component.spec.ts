import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  AdminOverviewFacade,
  ClientsFacade,
  ClientsService,
  type AdminOverviewMetrics,
  type AdminOverviewResponse,
  type AdminOverviewWorkspaceMetrics,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { BehaviorSubject, of } from 'rxjs';

import { AdminOverviewComponent } from './admin-overview.component';

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
  }

  @NgModule({ imports: [ChartStubComponent], exports: [ChartStubComponent] })
  class NgApexchartsModule {}

  return { NgApexchartsModule };
});

function workspaceMetrics(overrides: Partial<AdminOverviewWorkspaceMetrics> = {}): AdminOverviewWorkspaceMetrics {
  return {
    activeAgentCount: 2,
    activeUserCount: 1,
    totalMessages: 40,
    totalTokens: 1200,
    totalCostUsd: 0.5,
    openTicketCount: 3,
    inProgressTicketCount: 1,
    knowledgePageCount: 4,
    deploymentRunCount: 2,
    failedDeploymentRunCount: 1,
    automationRunCount: 3,
    failedAutomationRunCount: 0,
    activeAutomationRunCount: 1,
    taskRunCount: 5,
    failedTaskRunCount: 0,
    ...overrides,
  };
}

function metrics(overrides: Partial<AdminOverviewMetrics> = {}): AdminOverviewMetrics {
  return {
    ...workspaceMetrics(),
    workspaceCount: 2,
    filterDropCount: 1,
    filterFlagCount: 2,
    egressBlockedCount: 3,
    egressObservedCount: 4,
    ...overrides,
  };
}

function overview(scope: 'all' | 'workspace' = 'all'): AdminOverviewResponse {
  return {
    scope,
    clientId: scope === 'workspace' ? 'c1' : null,
    from: '2026-11-01',
    to: '2026-11-03',
    groupBy: 'day',
    metrics: metrics(),
    series: [{ period: '2026-11-02T00:00:00.000Z', count: 40, wordCount: 0, charCount: 0 }],
    securitySeries: [
      {
        period: '2026-11-03T00:00:00.000Z',
        filterDrops: 1,
        filterFlags: 2,
        egressAllowed: 0,
        egressBlocked: 3,
        egressObserved: 4,
      },
    ],
    workspaces:
      scope === 'workspace'
        ? [{ clientId: 'c1', name: 'Alpha', metrics: workspaceMetrics() }]
        : [
            { clientId: 'c1', name: 'Alpha', metrics: workspaceMetrics() },
            { clientId: 'c2', name: 'Beta', metrics: workspaceMetrics({ totalMessages: 0 }) },
          ],
  };
}

describe('AdminOverviewComponent', () => {
  let overview$: BehaviorSubject<AdminOverviewResponse | null>;
  let error$: BehaviorSubject<string | null>;
  let facade: { load: jest.Mock };
  let clientsFacade: Record<string, unknown> & {
    clients$: BehaviorSubject<unknown[]>;
    loadClients: jest.Mock;
    loadMoreClients: jest.Mock;
  };
  let params$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
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
    overview$ = new BehaviorSubject<AdminOverviewResponse | null>(overview());
    error$ = new BehaviorSubject<string | null>(null);
    facade = { load: jest.fn() };
    clientsFacade = {
      clients$: new BehaviorSubject<unknown[]>([{ id: 'c1', name: 'Alpha' }]),
      loading$: of(false),
      hasMore$: of(false),
      appendLoading$: of(false),
      appendError$: of(null),
      loadClients: jest.fn(),
      loadMoreClients: jest.fn(),
    };
    params$ = new BehaviorSubject(convertToParamMap({}));
  });

  function render(clientId: string | null = null) {
    params$.next(convertToParamMap(clientId ? { clientId } : {}));

    TestBed.configureTestingModule({
      imports: [AdminOverviewComponent],
      providers: [
        provideRouter([]),
        {
          provide: AdminOverviewFacade,
          useValue: { ...facade, overview$, error$, loading$: new BehaviorSubject(false), params$: of(null) },
        },
        { provide: ClientsFacade, useValue: clientsFacade },
        { provide: ClientsService, useValue: { listClients: jest.fn().mockReturnValue(of([])) } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params$, snapshot: { paramMap: params$.value, queryParamMap: convertToParamMap({}) } },
        },
      ],
    });

    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(AdminOverviewComponent);

    fixture.detectChanges();

    return { fixture, navigate, page: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('loads all workspaces for the last 30 days by day and the workspace list', () => {
    render();

    const params = facade.load.mock.calls[0][0];

    expect(params.clientId).toBeNull();
    expect(params.groupBy).toBe('day');
    expect((Date.parse(params.to) - Date.parse(params.from)) / 86_400_000).toBe(30);
    expect(clientsFacade.loadClients).toHaveBeenCalled();
  });

  it('renders the combined key figures, the area panels and the workspace table', () => {
    const { el } = render();

    expect(el.querySelector('[data-testid="admin-overview-kpi-workspaces"]')?.textContent?.trim()).toBe('2');
    expect(el.querySelector('[data-testid="admin-overview-kpi-cost"]')?.textContent?.trim()).toBe('$0.50');
    expect(el.querySelectorAll('[data-testid^="admin-overview-section-"]')).toHaveLength(4);
    expect(el.querySelector('[data-testid="admin-overview-section-tickets"] a')?.getAttribute('href')).toBe('/tickets');
    expect(el.querySelector('[data-testid="admin-overview-workspaces-table"]')).not.toBeNull();
  });

  it('links the area pages to the selected workspace and hides the workspace table', () => {
    overview$.next(overview('workspace'));

    const { el, page } = render('c1');

    expect(facade.load).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'c1' }));
    expect(page.workspaceChipLabel()).toBe('Alpha');
    expect(el.querySelector('[data-testid="admin-overview-workspace-chip"] i')?.className).toMatch(/bi-building(\s|$)/);

    expect(el.querySelector('[data-testid="admin-overview-section-tickets"] a')?.getAttribute('href')).toBe(
      '/tickets/c1',
    );
    expect(el.querySelector('[data-testid="admin-overview-section-deployments"] a')?.getAttribute('href')).toBe(
      '/pipelines/c1',
    );
    expect(el.querySelector('[data-testid="admin-overview-workspaces-table"]')).toBeNull();
  });

  it('fills the message and security series over every bucket of the range', () => {
    const { page } = render();

    expect(page.messagesChartOptions()?.series).toEqual([{ name: 'Messages', data: [0, 40, 0] }]);
    expect(page.securityChartOptions()?.series.map((s) => (s as { data: number[] }).data)).toEqual([
      [0, 0, 1],
      [0, 0, 2],
      [0, 0, 3],
      [0, 0, 4],
    ]);
  });

  it('shows all workspaces in the header chip', () => {
    const { el, page } = render();

    expect(page.workspaceChipLabel()).toBe('All workspaces');
    expect(el.querySelector('[data-testid="admin-overview-workspace-chip"]')?.textContent).toContain('All workspaces');
    expect(el.querySelector('[data-testid="admin-overview-workspace-chip"] i')?.className).toContain('bi-buildings');
  });

  it('switches workspaces through the route and keeps the filters', () => {
    const { navigate, page } = render('c1');

    page.openWorkspaceSwitch();
    expect(page.workspaceSwitchOpen()).toBe(true);
    page.selectWorkspace(null);
    expect(navigate).toHaveBeenCalledWith(['/overview'], { queryParamsHandling: 'preserve' });
    expect(page.workspaceSwitchOpen()).toBe(false);

    // The route change reloads with the new workspace.
    params$.next(convertToParamMap({ clientId: 'c2' }));
    expect(facade.load).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 'c2' }));
  });

  it('narrows to a workspace on row click', () => {
    const { navigate, page } = render();
    const [, beta] = overview().workspaces;

    expect(beta).toBeDefined();
    page.onWorkspaceRowActivate(beta as NonNullable<typeof beta>);

    expect(navigate).toHaveBeenCalledWith(['/overview', 'c2'], { queryParamsHandling: 'preserve' });
    // The workspace is not a drawer filter (it lives in the route and the header chip).
    expect(page.activeFilterCount()).toBe(0);
  });

  it('shows the hint for failed runs only', () => {
    const { page } = render();
    const deployments = page.sections().find((s) => s.id === 'deployments');

    expect(deployments?.items.find((i) => i.key === 'deploymentRuns')?.hint).toBe('1 failed');
    expect(deployments?.items.find((i) => i.key === 'taskRuns')?.hint).toBeNull();
  });

  it('shows the API error without stale figures', () => {
    overview$.next(null);
    error$.next('Admin only');

    const { el } = render();

    expect(el.querySelector('[data-testid="admin-overview-error"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="admin-overview-panels"]')).toBeNull();
  });
});
