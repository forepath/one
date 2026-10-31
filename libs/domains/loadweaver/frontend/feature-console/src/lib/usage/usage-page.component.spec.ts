import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleUsageFacade,
  ConsoleUsageService,
  type AccessMe,
  type UsageReport,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { LoadweaverMetricChartComponent } from '../metrics/metric-chart.component';
import { LW_SECTION_SCOPE } from '../section/section-scope';
import { accessStub, facadeStub } from '../testing';
import { LoadweaverUsagePageComponent } from './usage-page.component';

/** ApexCharts stays out of the page tests. */
@Component({ selector: 'loadweaver-metric-chart', template: '{{ series().length }} series', standalone: true })
class MetricChartStubComponent {
  readonly type = input('line');
  readonly series = input<unknown[]>([]);
  readonly unit = input<string | undefined>(undefined);
  readonly height = input(280);
}

const report: UsageReport = {
  cluster: 'lab',
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-20T12:00:00.000Z',
  granularity: 'day',
  meters: [
    { key: 'cpu_core_hours', unit: 'core-hours', description: 'CPU' },
    { key: 'memory_gib_hours', unit: 'GiB-hours', description: 'Memory' },
  ],
  rows: [
    { project: 'shop', bucket: '2026-10-19T00:00:00.000Z', meter: 'cpu_core_hours', value: 12.3456, final: true },
    { project: 'shop', bucket: '2026-10-20T00:00:00.000Z', meter: 'cpu_core_hours', value: 6, final: false },
    { project: 'shop', bucket: '2026-10-20T00:00:00.000Z', meter: 'memory_gib_hours', value: 24, final: false },
  ],
  totals: [
    { project: 'shop', meter: 'cpu_core_hours', value: 18.3456 },
    { project: 'shop', meter: 'memory_gib_hours', value: 24 },
  ],
  truncated: false,
};

describe('LoadweaverUsagePageComponent', () => {
  let fixture: ComponentFixture<LoadweaverUsagePageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let navigate: jest.SpyInstance;
  const service = { exportCsv: jest.fn() };

  async function create(
    me: AccessMe | null,
    query: Record<string, string> = {},
    current: UsageReport | null = report,
    scope: Record<string, string> | null = null,
  ) {
    facade = facadeStub({ report$: current, loading$: false, error$: null, query$: null }, ['load']);
    service.exportCsv.mockReset();

    await TestBed.configureTestingModule({
      imports: [LoadweaverUsagePageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: ConsoleUsageFacade, useValue: facade },
        { provide: ConsoleUsageService, useValue: service },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
        ...(scope ? [{ provide: LW_SECTION_SCOPE, useValue: { params: signal(scope) } }] : []),
      ],
    })
      .overrideComponent(LoadweaverUsagePageComponent, {
        remove: { imports: [LoadweaverMetricChartComponent] },
        add: { imports: [MetricChartStubComponent] },
      })
      .compileComponents();

    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoadweaverUsagePageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('loads the first project for project members and shows lines with totals', async () => {
    await create({ userId: 'u', clusterRole: null, projects: { shop: 'viewer', blog: 'admin' } });

    expect(facade['load']).toHaveBeenCalledTimes(1);
    expect(facade['load']).toHaveBeenCalledWith({ project: 'blog', granularity: 'day' });
    expect(navigate.mock.calls[0][1].queryParams).toMatchObject({ project: 'blog', granularity: null });

    // Overview first: one chart per meter with data, grouped by category.
    expect(
      [...el().querySelectorAll<HTMLElement>('[data-testid="usage-chart"]')].map((c) => c.dataset['meter']),
    ).toEqual(['cpu_core_hours', 'memory_gib_hours']);
    expect(el().querySelector('[data-testid="usage-chart"]')?.textContent).toContain('CPU (core-hours)');

    fixture.componentInstance.tab.set('lines');
    fixture.detectChanges();

    const rows = el().querySelectorAll('[data-testid="usage-table"] tbody tr.fpc-data-table__row');

    expect(rows).toHaveLength(2);
    expect(el().querySelector('fpc-list-header')).toBeNull();
    // Newest first; the open day is marked.
    expect(rows[0].querySelector('[data-testid="usage-open"]')).not.toBeNull();
    expect(rows[1].textContent).toContain('12.346');
    expect(el().querySelector('[data-testid="usage-totals"]')?.textContent).toContain('18.346 core-hours');
    // One summary column per meter (no empty eighth cell); units in the column heads.
    expect(el().querySelectorAll('[data-testid="usage-totals"] fpc-summary-card')).toHaveLength(7);
    expect(el().querySelector('[data-testid="usage-table"] thead')?.textContent).toContain('CPU (core-hours)');
  });

  it('lets cluster roles see all projects and keeps the URL filter', async () => {
    await create(
      { userId: 'u', clusterRole: 'auditor', projects: {} },
      { granularity: 'hour', from: '2026-10-20T00:00:00.000Z' },
    );

    expect(facade['load']).toHaveBeenCalledWith({
      project: null,
      granularity: 'hour',
      from: new Date('2026-10-20T00:00:00.000Z').toISOString(),
    });
    (el().querySelector('.fpc-list-toolbar__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const options = [...(el().querySelector('#lw-usage-project') as HTMLSelectElement).options].map((o) => o.value);

    expect(options).toEqual(['', 'shop']);
  });

  it('the overview drawer toggles which charts show (on Apply)', async () => {
    await create({ userId: 'u', clusterRole: null, projects: { shop: 'viewer' } });

    const page = fixture.componentInstance;

    page.onOverviewFiltersOpen(true);
    page.toggleMeter('memory_gib_hours', false);
    fixture.detectChanges();
    expect(el().querySelectorAll('[data-testid="usage-chart"]')).toHaveLength(2);

    page.applyOverview();
    fixture.detectChanges();
    expect(el().querySelectorAll('[data-testid="usage-chart"]')).toHaveLength(1);
    // The chosen project counts too.
    expect(el().querySelector('[data-testid="usage-overview-filter"] .badge')?.textContent?.trim()).toBe('2');

    page.reset();
    fixture.detectChanges();
    expect(el().querySelectorAll('[data-testid="usage-chart"]')).toHaveLength(2);
  });

  it('shows an empty state without projects and does not load', async () => {
    await create({ userId: 'u', clusterRole: null, projects: {} }, {}, null);

    expect(facade['load']).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="usage-no-projects"]')).not.toBeNull();
  });

  it('exports CSV for the current filter and reports failures', async () => {
    await create({ userId: 'u', clusterRole: null, projects: { shop: 'viewer' } });
    service.exportCsv.mockReturnValueOnce(of('project,bucket\n'));
    fixture.componentInstance.export();
    expect(service.exportCsv).toHaveBeenCalledWith({ project: 'shop', granularity: 'day' });

    service.exportCsv.mockReturnValueOnce(throwError(() => new Error('nope')));
    fixture.componentInstance.export();
    fixture.detectChanges();
    expect(fixture.componentInstance.exportError()).toBeTruthy();
  });

  it('embedded in a project tab: the scope project is fixed, no picker / header / URL writes', async () => {
    await create(
      { userId: 'u', clusterRole: null, projects: { shop: 'viewer', blog: 'admin' } },
      { project: 'blog' },
      report,
      { project: 'shop' },
    );

    expect(facade['load']).toHaveBeenCalledWith({ project: 'shop', granularity: 'day' });
    expect(navigate).not.toHaveBeenCalled();
    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(el().querySelector('.fpc-list-toolbar .badge')).toBeNull();

    (el().querySelector('.fpc-list-toolbar__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('#lw-usage-project')).toBeNull();

    fixture.componentInstance.reset();
    expect(fixture.componentInstance.project()).toBe('shop');
    expect(navigate).not.toHaveBeenCalled();
  });
});
