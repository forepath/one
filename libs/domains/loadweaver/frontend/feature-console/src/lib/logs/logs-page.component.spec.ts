import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleLogsFacade,
  LogsService,
  type LogLine,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

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

  async function create(query: Record<string, string> = {}) {
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

    expect(limit).toBe(100);
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
      100,
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
    expect(el().querySelector('.fpc-collapsible-filter-panel .badge')?.textContent?.trim()).toBe('5');
    (el().querySelector('.fpc-collapsible-filter-panel__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const error = el().querySelector('#lw-logs-level-error') as HTMLInputElement;

    expect(error.checked).toBe(true);
    error.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.levels().has('error')).toBe(false);
  });

  it('pages and expands a line with its labels', async () => {
    await create();
    (el().querySelector('[data-testid="logs-paging"] .fpc-pager__next') as HTMLButtonElement).click();
    expect(facade['next']).toHaveBeenCalled();

    (el().querySelector('[data-testid="logs-table"] tbody tr') as HTMLElement).click();
    fixture.detectChanges();

    const details = el().querySelector('[data-testid="logs-line-details"]');

    expect(details?.textContent).toContain('replica=shop/web/api/1');
    expect(details?.textContent).toContain('status=504');
    expect(details?.querySelector('a[href^="/topology?mode=timeline"]')).not.toBeNull();
  });

  it('follows new lines live with the filter and stops when left', async () => {
    await create({ project: 'shop', live: 'true' });

    const [filter] = (facade['startTail'] as jest.Mock).mock.calls[0];

    expect(filter).toMatchObject({ project: 'shop' });

    facade['tailing$'].next(true);
    facade['tail$'].next([line('9', { message: 'fresh line' })]);
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="logs-table"]')?.textContent).toContain('fresh line');
    expect(el().querySelector('[data-testid="logs-paging"]')).toBeNull();

    fixture.destroy();
    expect(facade['stopTail']).toHaveBeenCalled();
  });

  it('exports the shown filter', async () => {
    await create({ project: 'shop' });
    fixture.componentInstance.export('ndjson');

    expect(service.export).toHaveBeenCalledWith(expect.objectContaining({ project: 'shop' }), 'ndjson');
  });
});
