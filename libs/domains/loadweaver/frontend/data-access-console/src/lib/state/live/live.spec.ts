import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { LiveService } from '../../services/live.service';
import type { LiveTargets, TerminalSessionRecord } from '../../types/live.types';
import {
  loadLiveTargets,
  loadLiveTargetsFailure,
  loadLiveTargetsSuccess,
  loadTerminalSessions,
  loadTerminalSessionsSuccess,
  loadTunnels,
  loadTunnelsFailure,
} from './live.actions';
import { loadLiveTargets$, loadTerminalSessions$, loadTunnels$ } from './live.effects';
import { consoleLiveReducer, initialConsoleLiveState } from './live.reducer';
import { selectLiveProjects, selectLiveReplicas } from './live.selectors';

const targets: LiveTargets = {
  replicas: [
    {
      id: 'shop/web/api/0',
      project: 'shop',
      deployment: 'web',
      service: 'api',
      index: 0,
      node: 'n1',
      state: 'running',
    },
  ],
  volumes: [{ id: 'blog/site/data', project: 'blog', deployment: 'site', name: 'data' }],
  nodes: ['n1'],
};

const session: TerminalSessionRecord = {
  id: '2a4c1d0e-5b7f-4e2a-9c3d-8f1e6a0b2c4d',
  userId: 'u1',
  project: 'shop',
  target: 'replica/shop/web/api/0',
  node: 'n1',
  recorded: true,
  hasRecording: true,
  exitCode: 0,
  startedAt: '2026-10-18T09:12:03.000Z',
  endedAt: '2026-10-18T09:20:41.000Z',
};

describe('console live state', () => {
  it('keeps targets, sessions and tunnels', () => {
    let state = consoleLiveReducer(initialConsoleLiveState, loadLiveTargets());

    expect(state.targetsLoading).toBe(true);
    state = consoleLiveReducer(state, loadLiveTargetsSuccess({ targets }));
    expect(selectLiveReplicas.projector(state.targets)).toHaveLength(1);
    expect(selectLiveProjects.projector(state.targets)).toEqual(['blog', 'shop']);

    state = consoleLiveReducer(state, loadTerminalSessions({ project: null }));
    state = consoleLiveReducer(state, loadTerminalSessionsSuccess({ sessions: [session] }));
    expect(state.sessions).toEqual([session]);
    // Another project's filter doesn't show the old list while loading.
    state = consoleLiveReducer(state, loadTerminalSessions({ project: 'blog' }));
    expect(state).toMatchObject({ sessions: [], sessionsProject: 'blog', sessionsLoading: true });

    state = consoleLiveReducer(state, loadTunnels());
    state = consoleLiveReducer(state, loadTunnelsFailure({ error: 'nope' }));
    expect(state).toMatchObject({ tunnelsLoading: false, tunnelsError: 'nope' });
  });

  it('loads targets, sessions of a project and tunnels', async () => {
    const service = {
      targets: jest
        .fn()
        .mockReturnValueOnce(of(targets))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'forbidden' } }))),
      sessions: jest.fn().mockReturnValue(of([session])),
      tunnels: jest.fn().mockReturnValue(throwError(() => new Error('down'))),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(loadLiveTargets(), loadLiveTargets(), loadTerminalSessions({ project: 'shop' }), loadTunnels()),
        ),
        { provide: LiveService, useValue: service },
      ],
    });

    const run = (effect: () => ReturnType<typeof loadTunnels$>) =>
      firstValueFrom(TestBed.runInInjectionContext(effect).pipe(toArray()));

    expect(await run(() => loadLiveTargets$())).toEqual([
      loadLiveTargetsSuccess({ targets }),
      loadLiveTargetsFailure({ error: 'forbidden' }),
    ]);
    expect(await run(() => loadTerminalSessions$())).toEqual([loadTerminalSessionsSuccess({ sessions: [session] })]);
    expect(service.sessions).toHaveBeenCalledWith('shop');
    expect(await run(() => loadTunnels$())).toEqual([loadTunnelsFailure({ error: 'down' })]);
  });
});
