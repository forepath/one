import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleLogsFacade,
  LogsService,
  type LogLine,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { LW_SECTION_SCOPE } from '../section/section-scope';
import { accessStub, facadeStub } from '../testing';
import { LoadweaverLogsPageComponent } from './logs-page.component';

function line(id: string, overrides: Partial<LogLine> = {}): LogLine {
  return {
    id,
    at: '2026-10-18T08:41:07.512Z',
    source: 'container',
    level: 'warn',
    message: `upstream timeout ${id}`,
    node: 'n2',
    site: 'fra',
    labels: { project: 'shop', deployment: 'web', service: 'api', replica: 'shop/web/api/1' },
    fields: { status: 504 },
    ...overrides,
  };
}

describe('LoadweaverLogsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverLogsPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let navigate: jest.SpyInstance;
  const service = { export: jest.fn().mockReturnValue(of('{}\n')) };

  async function create(query: Record<string, string> = {}, scope: Record<string, string> | null = null) {
    facade = facadeStub(
      {
        lines$: [line('1'), line('2', { level: 'error', source: 'proxy' })],
        page$: 0,
        hasNext$: true,
        hasPrevious$: false,
        loading$: false,
        error$: null,
        tailing$: false,
        tailConnected$: false,
        tailError$: null,
        tail$: [],
      },
      ['search', 'next', 'previous', 'startTail', 'stopTail', 'clearTail'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverLogsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: ConsoleLogsFacade, useValue: facade },
        { provide: LogsService, useValue: service },
        ...(scope ? [{ provide: LW_SECTION_SCOPE, useValue: { params: signal(scope) } }] : []),
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: null, projects: { shop: 'developer' } }),
        },
      ],
    }).compileComponents();

    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoadweaverLogsPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('searches the last hour by default and shows the lines', async () => {
    await create();

    const [filter, limit] = (facade['search'] as jest.Mock).mock.calls[0];

    expect(limit).toBe(25);
    expect(new Date(filter.to).getTime() - new Date(filter.from).getTime()).toBe(3_600_000);
    expect(el().querySelector('[data-testid="logs-table"]')?.textContent).toContain('upstream timeout 2');
  });

  it('takes the filter from deep links and writes it back', async () => {
    await create({
      project: 'shop',
      service: 'api',
      sources: 'firewall,proxy,bogus',
      levels: 'error',
      from: '2026-10-18T08:00:00.000Z',
      to: '2026-10-18T09:00:00.000Z',
    });

    expect(facade['search']).toHaveBeenCalledWith(
      {
        from: '2026-10-18T08:00:00.000Z',
        to: '2026-10-18T09:00:00.000Z',
        sources: ['firewall', 'proxy'],
        levels: ['error'],
        project: 'shop',
        service: 'api',
      },
      25,
    );
    expect(navigate.mock.calls[0][1].queryParams).toMatchObject({
      range: null,
      from: '2026-10-18T08:00:00.000Z',
      sources: 'firewall,proxy',
      project: 'shop',
      service: 'api',
      live: null,
    });

    // The panel counts range, sources, levels, project and service; levels are checkboxes inside it.
    expect(el().querySelector('.fpc-list-toolbar .badge')?.textContent?.trim()).toBe('5');
    (el().querySelector('.fpc-list-toolbar__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const error = el().querySelector('#lw-logs-level-error') as HTMLInputElement;

    expect(error.checked).toBe(true);
    error.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.levels().has('error')).toBe(false);
  });

  it('pages and expands a line with its labels', async () => {
    await create();
    (
      el().querySelector(
        '[data-testid="logs-table"] [data-testid="fpc-data-table-pager"] .fpc-pager__next',
      ) as HTMLButtonElement
    ).click();
    expect(facade['next']).toHaveBeenCalled();

    (el().querySelector('[data-testid="logs-table"] tbody tr.fpc-data-table__row td') as HTMLElement).click();
    fixture.detectChanges();

    const details = el().querySelector('[data-testid="logs-line-details"]');

    expect(details?.textContent).toContain('replica=shop/web/api/1');
    expect(details?.textContent).toContain('status=504');
    expect(details?.querySelector('a[href^="/observe/topology?mode=timeline"]')).not.toBeNull();
  });

  it('follows new lines live with the filter and stops when left', async () => {
    await create({ project: 'shop', live: 'true' });

    const [filter] = (facade['startTail'] as jest.Mock).mock.calls[0];

    expect(filter).toMatchObject({ project: 'shop' });

    facade['tailing$'].next(true);
    facade['tail$'].next([line('9', { message: 'fresh line' })]);
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="logs-table"]')?.textContent).toContain('fresh line');
    expect(el().querySelector('[data-testid="logs-table"] [data-testid="fpc-data-table-pager"]')).toBeNull();
    // One Follow / Stop toggle (3.38 Appendix A): now stops.
    const toggle = el().querySelector('[data-testid="logs-tail-toggle"] button') as HTMLButtonElement;

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    expect(facade['stopTail']).toHaveBeenCalled();

    fixture.destroy();
    expect(facade['stopTail']).toHaveBeenCalled();
  });

  it('exports the shown filter', async () => {
    await create({ project: 'shop' });
    fixture.componentInstance.export('ndjson');

    expect(service.export).toHaveBeenCalledWith(expect.objectContaining({ project: 'shop' }), 'ndjson');
  });

  it('embedded in an object tab: the scope fixes the labels, no URL writes, no header or fixed pickers', async () => {
    await create({ project: 'other' }, { project: 'shop', deployment: 'web' });

    expect(facade['search']).toHaveBeenCalledWith(expect.objectContaining({ project: 'shop', deployment: 'web' }), 25);
    expect(navigate).not.toHaveBeenCalled();
    expect(el().querySelector('fpc-page-header')).toBeNull();
    // The actions moved into the table's toolbar strip.
    expect(el().querySelector('.fpc-list-toolbar [data-testid="logs-tail-toggle"]')).not.toBeNull();
    // Fixed labels are not counted and survive Clear all.
    expect(el().querySelector('.fpc-list-toolbar .badge')).toBeNull();
    (el().querySelector('.fpc-list-toolbar__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="logs-project"]')).toBeNull();
    expect(el().querySelector('#lw-logs-deployment')).toBeNull();
    expect(el().querySelector('#lw-logs-service')).not.toBeNull();

    fixture.componentInstance.resetFilters();
    expect(fixture.componentInstance.labels()).toMatchObject({ project: 'shop', deployment: 'web' });
    expect(navigate).not.toHaveBeenCalled();
  });
});
