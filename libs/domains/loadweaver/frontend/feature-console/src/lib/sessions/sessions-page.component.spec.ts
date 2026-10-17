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

const tunnel: TunnelRecord = {
  id: 't1',
  userId: 'u1',
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
          session('s1'),
          session('s2', {
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
    expect(table).toContain('running');
    expect(el().querySelectorAll('[data-testid="sessions-play"]')).toHaveLength(1);
    expect(el().querySelector('[data-testid="tunnels-table"]')?.textContent).toContain('5432');

    component().onProjectChange('shop');
    expect(live['loadSessions']).toHaveBeenLastCalledWith('shop');
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

  it('builds the port-forward command for a deep-linked replica', async () => {
    await create({ replica: 'shop/web/db/0' });

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
