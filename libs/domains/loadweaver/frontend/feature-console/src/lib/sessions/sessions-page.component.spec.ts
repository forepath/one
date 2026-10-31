import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleLiveFacade,
  LiveService,
  type TerminalSessionRecord,
  type TunnelRecord,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverSessionsPageComponent } from './sessions-page.component';

function session(id: string, overrides: Partial<TerminalSessionRecord> = {}): TerminalSessionRecord {
  return {
    id,
    userId: 'u1',
    project: 'shop',
    target: 'replica/shop/web/api/0',
    node: 'n1',
    recorded: true,
    hasRecording: true,
    exitCode: 0,
    startedAt: '2026-10-18T09:12:03.000Z',
    endedAt: '2026-10-18T09:20:41.000Z',
    ...overrides,
  };
}

const ALICE = '6f1c1b0e-0000-4000-8000-000000000001';
const GONE = '6f1c1b0e-0000-4000-8000-0000000000ff';

const tunnel: TunnelRecord = {
  id: 't1',
  userId: ALICE,
  userEmail: 'alice@example.com',
  project: 'shop',
  replica: 'shop/web/db/0',
  node: 'n1',
  port: 5432,
  openedAt: '2026-10-18T09:00:00.000Z',
  expiresAt: '2099-10-18T10:00:00.000Z',
};

describe('LoadweaverSessionsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverSessionsPageComponent>;
  let live: ReturnType<typeof facadeStub>;
  let service: Record<string, jest.Mock>;

  async function create(query: Record<string, string> = {}) {
    live = facadeStub(
      {
        sessions$: [
          session('s1', { userId: ALICE, userEmail: 'alice@example.com' }),
          session('s2', {
            userId: GONE,
            userEmail: null,
            target: 'node/n2',
            project: null,
            hasRecording: false,
            recorded: true,
            endedAt: null,
            exitCode: null,
          }),
        ],
        sessionsLoading$: false,
        sessionsError$: null,
        tunnels$: [tunnel],
        tunnelsLoading$: false,
        tunnelsError$: null,
        replicas$: [
          {
            id: 'shop/web/db/0',
            project: 'shop',
            deployment: 'web',
            service: 'db',
            index: 0,
            node: 'n1',
            state: 'running',
          },
        ],
      },
      ['loadTargets', 'loadSessions', 'loadTunnels'],
    );
    service = {
      recording: jest.fn().mockReturnValue(of('{"version":2,"width":80,"height":24}\n[0.1,"o","hi"]\n')),
    };

    await TestBed.configureTestingModule({
      imports: [LoadweaverSessionsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: ConsoleLiveFacade, useValue: live },
        { provide: LiveService, useValue: service },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: 'auditor', projects: { shop: 'admin' } }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverSessionsPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const component = () => fixture.componentInstance;

  it('loads sessions, tunnels and filters by project', async () => {
    await create();

    expect(live['loadSessions']).toHaveBeenCalledWith(null);
    expect(live['loadTunnels']).toHaveBeenCalled();

    const table = el().querySelector('[data-testid="sessions-table"]')?.textContent ?? '';

    expect(table).toContain('shop/web/api/0');
    expect(table).toContain('node shell n2');
    expect(table).toContain('8m 38s');
    expect(
      [...el().querySelectorAll('[data-testid="sessions-table"] [data-testid="fpc-data-table-state"]')].map((b) =>
        b.getAttribute('aria-label'),
      ),
    ).toContain(component().runningLabel);
    expect(el().querySelectorAll('[data-testid="sessions-play"]')).toHaveLength(1);
    expect(el().querySelector('[data-testid="tunnels-table"]')?.textContent).toContain('5432');

    // The project filter sits in the filter panel.
    expect(el().querySelector('[data-testid="sessions-project"]')).toBeNull();
    (el().querySelector('.fpc-list-toolbar__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const select = el().querySelector('[data-testid="sessions-project"] select') as HTMLSelectElement;

    select.value = 'shop';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // Filters apply live (3.38 R12, 2026-10-29): the server query follows the change right away.
    expect(live['loadSessions']).toHaveBeenLastCalledWith('shop');
  });

  it('shows who by email ("Deleted user" when gone), never the raw user id (D11)', async () => {
    await create();

    const sessions = el().querySelector('[data-testid="sessions-table"]')?.textContent ?? '';
    const tunnels = el().querySelector('[data-testid="tunnels-table"]')?.textContent ?? '';

    expect(sessions).toContain('alice@example.com');
    expect(sessions).toContain('Deleted user');
    expect(sessions).not.toContain(ALICE);
    expect(sessions).not.toContain(GONE);
    expect(tunnels).toContain('alice@example.com');
    expect(tunnels).not.toContain(ALICE);

    // The lane search matches what is shown.
    component().search.set('alice@');
    expect(
      component()
        .filteredSessions()
        .map((s) => s.id),
    ).toEqual(['s1']);
  });

  it('renders Play inline, Download in ⋮, no row counts in the lane headers and filters by search', async () => {
    await create();

    expect(el().querySelector('[data-testid="sessions-play"] .btn')?.className).toContain('btn-secondary');
    const recorded = component()
      .filteredSessions()
      .find((s) => s.hasRecording)!;

    expect(
      component()
        .sessionMenu(recorded)
        .map((item) => item.id),
    ).toEqual(['play', 'download', 'copy-id']);
    // Decision 8: no totals in the lane headers (the pager counts).
    expect(el().querySelector('[data-testid="sessions-lane"] fpc-lane-header fpc-badge')).toBeNull();

    component().search.set('n2');
    fixture.detectChanges();
    expect(component().filteredSessions()).toHaveLength(1);
    expect(el().querySelector('[data-testid="sessions-table"]')?.textContent).not.toContain('shop/web/api/0');

    component().search.set('nothing-like-this');
    component().tunnelSearch.set('nothing-like-this');
    fixture.detectChanges();
    expect(
      el().querySelector('[data-testid="sessions-table"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
    expect(
      el().querySelector('[data-testid="tunnels-table"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
  });

  it('replays a recording in the browser', async () => {
    await create();
    await component().play(session('s1'));
    fixture.detectChanges();

    expect(service['recording']).toHaveBeenCalledWith('s1');
    expect(component().playing()?.cast.events).toHaveLength(1);
    expect(el().querySelector('[data-testid="sessions-player"] loadweaver-cast-player')).not.toBeNull();

    component().closePlayer();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="sessions-player"]')).toBeNull();
  });

  it('shows recording errors', async () => {
    await create();
    service['recording'].mockReturnValueOnce(of('not a cast')).mockReturnValueOnce(throwError(() => new Error('gone')));

    await component().play(session('s1'));
    expect(component().recordingError()).toBe('the header is not JSON');
    await component().download(session('s1'));
    expect(component().recordingError()).toBe('gone');
  });

  it('opens the port-forward dialog from the tunnels panel', async () => {
    await create();

    expect(el().querySelector('[data-testid="port-forward"]')).toBeNull();
    (el().querySelector('[data-testid="port-forward-open"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="port-forward"] [data-testid="forward-replica"]')).not.toBeNull();
    expect(component().command()).toBeNull();
  });

  it('builds the port-forward command for a deep-linked replica', async () => {
    await create({ replica: 'shop/web/db/0' });

    expect(component().forwardOpen()).toBe(true);

    expect(component().command()).toBe('loadweaver port-forward shop/web/db/0 <port>');
    component().remotePort.set(component().port('5432'));
    component().localPort.set(component().port('15432'));
    component().ttl.set(component().ttlSeconds('30'));
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="forward-command"]')?.textContent?.trim()).toBe(
      'loadweaver port-forward shop/web/db/0 15432:5432',
    );
  });
});
