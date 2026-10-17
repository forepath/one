import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleDashboardsFacade,
  ConsoleMetricsFacade,
  type DashboardResource,
} from '@forepath/loadweaver/frontend/data-access-console';

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
  let metrics: ReturnType<typeof facadeStub>;
  let dashboards: ReturnType<typeof facadeStub>;

  async function create(query: Record<string, string> = {}) {
    metrics = facadeStub(
      {
        names$: ['node.cpu_cores', 'replica.memory_bytes'],
        namesError$: null,
        result$: null,
        loading$: false,
        error$: null,
        events$: [],
      },
      ['loadNames', 'query'],
    );
    dashboards = facadeStub({ dashboards$: [], loading$: false, error$: null, selected$: null, widgets$: {} }, [
      'load',
      'run',
    ]);

    await TestBed.configureTestingModule({
      imports: [LoadweaverMetricsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: ConsoleMetricsFacade, useValue: metrics },
        { provide: ConsoleDashboardsFacade, useValue: dashboards },
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

    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoadweaverMetricsPageComponent);
    fixture.detectChanges();
    // The tab group activates its tab in an effect: flush it, then render the tab's content.
    TestBed.tick();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('offers the readable metric names and graphs the picked one', async () => {
    await create();

    expect(metrics['loadNames']).toHaveBeenCalled();
    expect(dashboards['load']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="metrics-names"]')?.textContent).toContain('replica.memory_bytes');

    fixture.componentInstance.metric.set('replica.memory_bytes');
    fixture.componentInstance.groupBy.set('node');
    fixture.componentInstance.show();

    const query = (metrics['query'] as jest.Mock).mock.calls[0][0];

    expect(query).toMatchObject({ metric: 'replica.memory_bytes', groupBy: 'node', aggregation: 'avg' });
    expect(new Date(query.to).getTime() - new Date(query.from).getTime()).toBe(3_600_000);

    metrics['result$'].next({ step: '10 seconds', series: [{ key: 'n1', points: [['2026-10-18T08:00:00Z', 1]] }] });
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="metrics-chart"]')?.textContent).toContain('1 series');
  });

  it('runs a deep-linked metric query', async () => {
    await create({ metric: 'node.cpu_cores', range: '7d', aggregation: 'max', entity: 'n1' });

    const query = (metrics['query'] as jest.Mock).mock.calls[0][0];

    expect(query).toMatchObject({ metric: 'node.cpu_cores', aggregation: 'max', entity: 'n1' });
    expect(new Date(query.to).getTime() - new Date(query.from).getTime()).toBe(7 * 86_400_000);
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
    expect(widgets[1].style.gridColumn).toBe('7 / span 6');
    expect(widgets[0].textContent).toContain('1 series');
    expect(widgets[1].querySelector('[data-testid="widget-stat"]')?.textContent).toContain('12.5');

    fixture.componentInstance.onDashboardProjectChange('shop');
    expect((dashboards['run'] as jest.Mock).mock.calls.at(-1)[1]).toMatchObject({ project: 'shop' });
  });
});
