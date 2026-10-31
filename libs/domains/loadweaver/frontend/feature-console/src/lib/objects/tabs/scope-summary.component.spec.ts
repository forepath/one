import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleOverviewFacade,
  type Overview,
} from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub } from '../../testing';
import { LoadweaverScopeSummaryComponent } from './scope-summary.component';

const overview: Overview = {
  headline: { state: 'degraded', message: 'One node is down', key: null },
  inbox: [
    { kind: 'alert', severity: 'critical', title: 'Disk full on n1', link: '/observe/alerts', project: 'shop' },
    { kind: 'drift', severity: 'warning', title: 'Drift in blog', link: '/delivery/drift', project: 'blog' },
  ],
  summary: {
    sites: 1,
    nodes: { total: 2, up: 1 },
    deployments: 3,
    capacity: null,
    requestsPerSecond: null,
    deniedPackets5m: null,
    alertsFiring: 1,
    slos: { total: 0, ok: 0, burning: 0, exhausted: 0 },
  },
  activity: [
    { time: '2026-10-28T10:00:00.000Z', kind: 'plan', entity: 'p1', project: 'shop', message: 'Plan applied' },
  ],
};

describe('LoadweaverScopeSummaryComponent (3.38)', () => {
  async function setup(value: Overview | null, loading = false) {
    const facade = facadeStub({ overview$: value, loading$: loading, error$: null }, ['load']);

    await TestBed.configureTestingModule({
      imports: [LoadweaverScopeSummaryComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleOverviewFacade, useValue: facade },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverScopeSummaryComponent);

    fixture.detectChanges();

    return { fixture, facade, el: fixture.nativeElement as HTMLElement };
  }

  it('drops the headline strip and shows both lanes as tables without counts', async () => {
    const { el, facade } = await setup(overview);

    expect(facade['load']).toHaveBeenCalledWith(undefined);
    expect(el.querySelector('[data-testid="overview-headline"]')).toBeNull();
    expect(el.querySelector('fpc-status-badge')).toBeNull();
    expect(el.querySelectorAll('[data-testid="overview-inbox"] tr.fpc-data-table__row')).toHaveLength(2);
    expect(el.querySelector('[data-testid="summary-lane-inbox"] fpc-lane-header fpc-badge')).toBeNull();
    expect(
      el
        .querySelector('[data-testid="overview-inbox"] [data-testid="fpc-data-table-state"]')
        ?.getAttribute('aria-label'),
    ).toBe('Critical');
    expect(el.querySelector('[data-testid="overview-inbox"] a.fpc-data-table__link')?.getAttribute('href')).toBe(
      '/observe/alerts',
    );
    expect(el.querySelector('[data-testid="overview-inbox"]')?.textContent).toContain('Alert');
    expect(el.querySelector('[data-testid="overview-activity"]')?.textContent).toContain('Plan applied');
  });

  it('notes the SLOs as of the last stored sample only while the control plane is read-only (3.43)', async () => {
    const { el } = await setup(overview);

    expect(el.querySelector('[data-testid="overview-slos-as-of"]')).toBeNull();

    TestBed.resetTestingModule();

    const readOnly = await setup({
      ...overview,
      summary: { ...overview.summary, readOnly: { metricsAsOf: '2026-10-31T08:00:00.000Z' } },
    });
    const note = readOnly.el.querySelector('[data-testid="overview-slos-as-of"]')?.textContent ?? '';

    expect(note).toContain('as of');
    expect(note).toContain('(read-only)');

    TestBed.resetTestingModule();

    const none = await setup({ ...overview, summary: { ...overview.summary, readOnly: { metricsAsOf: null } } });

    expect(none.el.querySelector('[data-testid="overview-slos-as-of"]')?.textContent).toContain('no stored metrics');
  });

  it('searches a lane and shows no matches instead of the list', async () => {
    const { fixture, el } = await setup(overview);

    fixture.componentInstance.inboxSearch.set('blog');
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="overview-inbox"] tr.fpc-data-table__row')).toHaveLength(1);

    fixture.componentInstance.inboxSearch.set('nothing like this');
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="overview-inbox"] tr.fpc-data-table__row')).toHaveLength(0);
    expect(el.querySelector('[data-testid="overview-inbox"] [data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
  });

  it('shows the loading state in the empty-state box', async () => {
    const { el } = await setup(null, true);

    expect(el.querySelector('fpc-empty-state [aria-busy="true"], fpc-empty-state[aria-busy="true"]')).not.toBeNull();
  });
});
