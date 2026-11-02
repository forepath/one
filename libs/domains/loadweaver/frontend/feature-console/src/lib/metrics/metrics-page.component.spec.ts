import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleDashboardsFacade,
  MetricsService,
  type DashboardResource,
  type MetricQuery,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { LW_SECTION_SCOPE } from '../section/section-scope';
import { accessStub, facadeStub } from '../testing';
import { LoadweaverDashboardWidgetComponent } from './dashboard-widget.component';
import { LoadweaverMetricChartComponent } from './metric-chart.component';
import { LoadweaverMetricsPageComponent } from './metrics-page.component';

/** ApexCharts stays out of the page tests. */
@Component({ selector: 'loadweaver-metric-chart', template: '{{ series().length }} series', standalone: true })
class MetricChartStubComponent {
  readonly type = input('line');
  readonly series = input<unknown[]>([]);
  readonly unit = input<string | undefined>(undefined);
  readonly height = input(280);
  readonly events = input<unknown[]>([]);
  readonly seriesLabel = input<unknown>(undefined);
}

const dashboard: DashboardResource = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'Dashboard',
  metadata: { name: 'shop-overview', project: 'shop' },
  spec: {
    title: 'Shop overview',
    range: '24h',
    widgets: [
      {
        title: 'Memory',
        type: 'line',
        x: 0,
        y: 0,
        w: 6,
        h: 4,
        query: { metrics: { metric: 'replica.memory_bytes' } },
      },
      {
        title: 'Requests',
        type: 'stat',
        x: 6,
        y: 0,
        w: 6,
        h: 2,
        query: { metrics: { metric: 'ingress.requests_per_s' } },
      },
    ],
  },
};

describe('LoadweaverMetricsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverMetricsPageComponent>;
  let service: { names: jest.Mock; query: jest.Mock; events: jest.Mock };
  let dashboards: ReturnType<typeof facadeStub>;

  let navigate: jest.SpyInstance;

  const point = (value: number): [string, number] => ['2026-10-18T08:00:00Z', value];

  async function create(
    query: Record<string, string> = {},
    scope: Record<string, string> | null = null,
    names: string[] = ['node.cpu_cores', 'replica.memory_bytes', 'replica.cpu_seconds', 'custom.queue_depth'],
  ) {
    service = {
      names: jest.fn(() => of(names)),
      query: jest.fn((q: MetricQuery) =>
        q.metric === 'custom.queue_depth'
          ? throwError(() => new Error('boom'))
          : of({
              step: '10 seconds',
              series: [
                { key: 'n1', points: [point(1.5)] },
                { key: 'n2', points: [point(2)] },
              ],
            }),
      ),
      events: jest.fn(() => of([])),
    };
    dashboards = facadeStub({ dashboards$: [], loading$: false, error$: null, selected$: null, widgets$: {} }, [
      'load',
      'run',
    ]);

    await TestBed.configureTestingModule({
      imports: [LoadweaverMetricsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: MetricsService, useValue: service },
        { provide: ConsoleDashboardsFacade, useValue: dashboards },
        ...(scope ? [{ provide: LW_SECTION_SCOPE, useValue: { params: signal(scope) } }] : []),
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: null, projects: { shop: 'developer' } }),
        },
      ],
    })
      .overrideComponent(LoadweaverMetricsPageComponent, {
        remove: { imports: [LoadweaverMetricChartComponent] },
        add: { imports: [MetricChartStubComponent] },
      })
      .overrideComponent(LoadweaverDashboardWidgetComponent, {
        remove: { imports: [LoadweaverMetricChartComponent] },
        add: { imports: [MetricChartStubComponent] },
      })
      .compileComponents();

    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoadweaverMetricsPageComponent);
    fixture.detectChanges();
    // The tab group activates its tab in an effect: flush it, then render the tab's content.
    TestBed.tick();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const categories = () =>
    [...el().querySelectorAll<HTMLElement>('[data-testid="metrics-category"]')].map((c) => c.dataset['category']);

  it('loads every metric at once and shows them grouped by category with key figures', async () => {
    await create();

    expect(dashboards['load']).toHaveBeenCalled();
    // One query per metric; the usage-metering counter stays on the usage page.
    const metrics = service.query.mock.calls.map(([q]) => q.metric);

    expect(metrics).toEqual(['node.cpu_cores', 'replica.memory_bytes', 'custom.queue_depth']);

    const first = service.query.mock.calls[0][0];

    expect(first).toMatchObject({ groupBy: 'entity', aggregation: 'avg' });
    expect(new Date(first.to).getTime() - new Date(first.from).getTime()).toBe(3_600_000);
    expect(categories()).toEqual(['nodes', 'workloads', 'other']);
    // Readable chart titles; the failed query shows its error in its own panel.
    const panels = el().querySelectorAll('[data-testid="metrics-chart-panel"]');

    expect(panels).toHaveLength(3);
    expect(panels[0].textContent).toContain('Node CPU');
    expect(panels[0].querySelector('[data-testid="metrics-chart"]')?.textContent).toContain('2 series');
    expect(panels[2].textContent).toContain('custom.queue_depth');
    expect(panels[2].querySelector('fpc-alert')).not.toBeNull();
    // Key figures: newest values summed over the series.
    const summary = el().querySelector('[data-testid="metrics-summary"]')?.textContent ?? '';

    expect(summary).toContain('Node CPU');
    expect(summary).toContain('3.5 cores');
    expect(el().querySelector('[data-testid="metrics-names"]')).toBeNull();
  });

  it('the filter only toggles what is shown: categories, charts and series, without reloading', async () => {
    await create();

    const calls = service.query.mock.calls.length;
    const page = fixture.componentInstance;

    page.toggleCategory('nodes', false);
    page.toggleChart('custom.queue_depth', false);
    page.visibility.patch({ series: 'n2' });
    page.visibility.apply();
    fixture.detectChanges();

    expect(categories()).toEqual(['workloads']);
    expect(el().querySelector('[data-testid="metrics-chart"]')?.textContent).toContain('1 series');
    expect(el().querySelector('.fpc-list-toolbar .badge')?.textContent?.trim()).toBe('3');
    expect(service.query.mock.calls.length).toBe(calls);

    page.clearVisibility();
    fixture.detectChanges();
    expect(categories()).toEqual(['nodes', 'workloads', 'other']);
  });

  it('scope controls and deep-linked filters reload the data', async () => {
    await create({ range: '7d', aggregation: 'max', entity: 'web' });

    const first = service.query.mock.calls[0][0];

    expect(first).toMatchObject({ aggregation: 'max', entity: 'web' });
    expect(new Date(first.to).getTime() - new Date(first.from).getTime()).toBe(7 * 86_400_000);
    expect(fixture.componentInstance.chips().map((c) => c.id)).toEqual(['entity']);

    service.query.mockClear();
    fixture.componentInstance.setScope({ groupBy: 'node' });
    expect(service.query.mock.calls[0][0]).toMatchObject({ groupBy: 'node', entity: 'web' });

    service.query.mockClear();
    fixture.componentInstance.removeChip({ id: 'entity', value: 'web' });
    expect(service.query.mock.calls[0][0].entity).toBeUndefined();
    expect(navigate).toHaveBeenCalled();
  });

  it('applies the workspace link (project + replica entity prefix) as the query scope', async () => {
    await create({ project: 'shop', entity: 'shop/site/web/*' });

    expect(service.query.mock.calls[0][0]).toMatchObject({ project: 'shop', entity: 'shop/site/web/*' });
    expect(fixture.componentInstance.chips().map((c) => c.id)).toEqual(['entity']);
  });

  it('says so when there are no samples', async () => {
    await create({}, null, []);

    expect(el().querySelector('[data-testid="metrics-empty"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="metrics-summary"]')).toBeNull();
  });

  it('runs the deep-linked dashboard with its own range and lays out its widgets', async () => {
    await create({ dashboard: 'shop/shop-overview' });
    dashboards['dashboards$'].next([dashboard]);
    fixture.detectChanges();

    const [key, filter] = (dashboards['run'] as jest.Mock).mock.calls[0];

    expect(key).toBe('shop/shop-overview');
    expect(new Date(filter.to).getTime() - new Date(filter.from).getTime()).toBe(86_400_000);

    dashboards['selected$'].next(dashboard);
    dashboards['widgets$'].next({
      0: {
        loading: false,
        result: { kind: 'series', step: '1 minute', series: [{ key: 'a', points: [['2026-10-18T08:00:00Z', 2]] }] },
        error: null,
      },
      1: {
        loading: false,
        result: {
          kind: 'series',
          step: '1 minute',
          series: [{ key: 'all', points: [['2026-10-18T08:00:00Z', 12.5]] }],
        },
        error: null,
      },
    });
    fixture.detectChanges();

    const widgets = el().querySelectorAll<HTMLElement>('[data-testid="dashboard-grid"] loadweaver-dashboard-widget');

    expect(widgets).toHaveLength(2);
    expect(widgets[1].style.getPropertyValue('--lw-widget-column')).toBe('7 / span 6');
    expect(widgets[1].classList).toContain('fpc-panel-grid__cell');
    // The dashboard names the view in the header (no info strip).
    expect(el().querySelector('[data-testid="dashboard-context"]')?.textContent).toContain('Shop overview');
    expect(widgets[0].textContent).toContain('1 series');
    expect(widgets[1].querySelector('[data-testid="widget-stat"]')?.textContent).toContain('12.5');

    fixture.componentInstance.dashboardFilterState.patch({ project: 'shop' });
    fixture.componentInstance.dashboardFilterState.apply();
    expect((dashboards['run'] as jest.Mock).mock.calls.at(-1)[1]).toMatchObject({ project: 'shop' });
  });

  it('embedded in an object tab: overview only, the scope fixes node / entity, no URL writes', async () => {
    await create({ tab: 'dashboards' }, { project: 'shop', entity: 'web' });

    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(el().querySelector('fpc-tab-group')).toBeNull();
    expect(dashboards['load']).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="metrics-refresh"]')).not.toBeNull();
    expect(service.query.mock.calls[0][0]).toMatchObject({ project: 'shop', entity: 'web' });
    expect(fixture.componentInstance.chips()).toEqual([]);
    expect(el().querySelector('#lw-metrics-project')).toBeNull();

    fixture.componentInstance.clearVisibility();
    expect(fixture.componentInstance.entity()).toBe('web');
    expect(fixture.componentInstance.project()).toBe('shop');
    expect(navigate).not.toHaveBeenCalled();
  });
});
