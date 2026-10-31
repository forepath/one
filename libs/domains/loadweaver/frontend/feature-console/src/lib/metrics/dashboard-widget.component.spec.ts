import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { DashboardWidget, DashboardWidgetState } from '@forepath/loadweaver/frontend/data-access-console';

import { LoadweaverDashboardWidgetComponent } from './dashboard-widget.component';
import { LoadweaverMetricChartComponent } from './metric-chart.component';

@Component({ selector: 'loadweaver-metric-chart', template: '', standalone: true })
class MetricChartStubComponent {
  readonly type = input('line');
  readonly series = input<unknown[]>([]);
  readonly unit = input<string | undefined>(undefined);
  readonly height = input(280);
}

describe('LoadweaverDashboardWidgetComponent', () => {
  let fixture: ComponentFixture<LoadweaverDashboardWidgetComponent>;

  async function render(widget: DashboardWidget, state: DashboardWidgetState | null) {
    await TestBed.configureTestingModule({ imports: [LoadweaverDashboardWidgetComponent] })
      .overrideComponent(LoadweaverDashboardWidgetComponent, {
        remove: { imports: [LoadweaverMetricChartComponent] },
        add: { imports: [MetricChartStubComponent] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(LoadweaverDashboardWidgetComponent);
    fixture.componentRef.setInput('widget', widget);
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('shows flows as a table', async () => {
    await render(
      { title: 'Top denied', type: 'table', query: { flows: { decision: 'denied' } } },
      {
        loading: false,
        error: null,
        result: {
          kind: 'flows',
          rows: [
            {
              policy: '',
              src: '10.0.0.5',
              dst: '10.0.1.7',
              protocol: 'tcp',
              port: 22,
              decision: 'denied',
              packets: 120,
              bytes: 2048,
            },
          ],
        },
      },
    );

    expect(el().querySelector('[data-testid="widget-flows"]')?.textContent).toContain('tcp/22');
    expect(el().querySelector('[data-testid="widget-flows"]')?.textContent).toContain('2.0 KiB');
    // The decision is a readable State badge.
    expect(el().querySelector('[data-testid="fpc-data-table-state"]')?.getAttribute('aria-label')).toContain('Denied');
  });

  it('shows log lines and query errors', async () => {
    await render(
      { title: 'Errors', type: 'logs', query: { logs: { levels: ['error'] } } },
      {
        loading: false,
        error: null,
        result: {
          kind: 'logs',
          lines: [
            {
              id: '1',
              at: '2026-10-18T05:59:58.000Z',
              source: 'container',
              level: 'error',
              message: 'upstream timeout',
              node: 'n1',
              site: null,
              labels: {},
              fields: {},
            },
          ],
        },
      },
    );

    expect(el().querySelector('[data-testid="widget-logs"]')?.textContent).toContain('upstream timeout');

    fixture.componentRef.setInput('state', { loading: false, error: 'no flows visible', result: null });
    fixture.detectChanges();
    expect(el().textContent).toContain('no flows visible');
  });
});
