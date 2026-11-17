import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of, Subject, throwError, toArray } from 'rxjs';

import type { EnvironmentProgressService } from '../../services/environment-progress.service';
import { loadClientAgents, loadClientAgentsRailPage } from '../agents/agents.actions';
import { initialAgentsRailPageState } from '../agents/agents.reducer';
import { selectAgentsCreating, selectAgentsEntities, selectAgentsRailPage } from '../agents/agents.selectors';
import {
  forwardedEventReceived,
  remoteReconnected,
  setClientSuccess,
} from '../container-socket/container-socket.actions';
import { selectSelectedClientId } from '../container-socket/container-socket.selectors';

import {
  environmentProgressReceived,
  loadEnvironmentProgress,
  loadEnvironmentProgressFailure,
  loadEnvironmentProgressSuccess,
} from './environment-progress.actions';
import {
  extractEnvironmentProgress,
  loadEnvironmentProgress$,
  loadEnvironmentProgressOnClientSelected$,
  reloadAgentsOnEnvironmentCreated$,
  reloadAgentsRailOnEnvironmentCreated$,
  routeEnvironmentProgressEvents$,
} from './environment-progress.effects';
import type { EnvironmentProgress } from './environment-progress.types';

function op(overrides: Partial<EnvironmentProgress> = {}): EnvironmentProgress {
  return {
    operationId: 'op-1',
    agentId: 'agent-1',
    agentName: 'Agent',
    operation: 'create',
    status: 'running',
    step: 'pullingImage',
    stepIndex: 1,
    stepCount: 6,
    progress: 30,
    startedAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:10Z',
    ...overrides,
  };
}

function mockStore(values: Map<unknown, unknown>): Store {
  return { select: jest.fn((selector: unknown) => of(values.get(selector))) } as unknown as Store;
}

describe('EnvironmentProgressEffects', () => {
  const clientId = 'client-1';

  describe('loadEnvironmentProgress$', () => {
    it('should load progress', (done) => {
      const service = { listClientEnvironmentProgress: jest.fn().mockReturnValue(of([op()])) };

      loadEnvironmentProgress$(
        of(loadEnvironmentProgress({ clientId })) as Actions,
        service as unknown as EnvironmentProgressService,
      ).subscribe((result) => {
        expect(result).toEqual(loadEnvironmentProgressSuccess({ clientId, operations: [op()] }));
        expect(service.listClientEnvironmentProgress).toHaveBeenCalledWith(clientId);
        done();
      });
    });

    it('should report invalid non-array responses', (done) => {
      const service = { listClientEnvironmentProgress: jest.fn().mockReturnValue(of(null)) };

      loadEnvironmentProgress$(
        of(loadEnvironmentProgress({ clientId })) as Actions,
        service as unknown as EnvironmentProgressService,
      ).subscribe((result) => {
        expect(result).toEqual(
          loadEnvironmentProgressFailure({ clientId, error: 'Invalid environment progress response' }),
        );
        done();
      });
    });

    it('should map errors to failure', (done) => {
      const service = { listClientEnvironmentProgress: jest.fn().mockReturnValue(throwError(() => new Error('boom'))) };

      loadEnvironmentProgress$(
        of(loadEnvironmentProgress({ clientId })) as Actions,
        service as unknown as EnvironmentProgressService,
      ).subscribe((result) => {
        expect(result).toEqual(loadEnvironmentProgressFailure({ clientId, error: 'boom' }));
        done();
      });
    });

    it('should cancel superseded snapshots without cancelling another workspace', () => {
      const actions = new Subject<ReturnType<typeof loadEnvironmentProgress>>();
      const first = new Subject<EnvironmentProgress[]>();
      const other = new Subject<EnvironmentProgress[]>();
      const latest = new Subject<EnvironmentProgress[]>();
      const service = {
        listClientEnvironmentProgress: jest
          .fn()
          .mockReturnValueOnce(first)
          .mockReturnValueOnce(other)
          .mockReturnValueOnce(latest),
      };
      const results: unknown[] = [];
      const subscription = loadEnvironmentProgress$(
        actions as Actions,
        service as unknown as EnvironmentProgressService,
      ).subscribe((result) => results.push(result));

      actions.next(loadEnvironmentProgress({ clientId }));
      actions.next(loadEnvironmentProgress({ clientId: 'client-2' }));
      actions.next(loadEnvironmentProgress({ clientId }));
      latest.next([]);
      first.next([op()]);
      other.next([op()]);

      expect(results).toEqual([
        loadEnvironmentProgressSuccess({ clientId, operations: [] }),
        loadEnvironmentProgressSuccess({ clientId: 'client-2', operations: [op()] }),
      ]);
      subscription.unsubscribe();
    });
  });

  it('should load progress when a workspace is selected or reconnected', (done) => {
    loadEnvironmentProgressOnClientSelected$(
      of(setClientSuccess({ clientId, message: 'ok' }), remoteReconnected({ clientId: 'client-2' })) as Actions,
    )
      .pipe(toArray())
      .subscribe((results) => {
        expect(results).toEqual([
          loadEnvironmentProgress({ clientId }),
          loadEnvironmentProgress({ clientId: 'client-2' }),
        ]);
        done();
      });
  });

  describe('routeEnvironmentProgressEvents$', () => {
    it('should route forwarded progress events to the selected workspace', (done) => {
      const store = mockStore(new Map([[selectSelectedClientId, clientId]]));
      const actions = of(
        forwardedEventReceived({ event: 'environmentProgress', payload: { success: true, data: op() } as never }),
        forwardedEventReceived({ event: 'chatMessage', payload: { success: true, data: op() } as never }),
        forwardedEventReceived({ event: 'environmentProgress', payload: { success: false } as never }),
      ) as Actions;

      routeEnvironmentProgressEvents$(actions, store)
        .pipe(toArray())
        .subscribe((results) => {
          expect(results).toEqual([environmentProgressReceived({ clientId, progress: op() })]);
          done();
        });
    });

    it('should ignore events without a selected workspace', (done) => {
      const store = mockStore(new Map([[selectSelectedClientId, null]]));

      routeEnvironmentProgressEvents$(
        of(
          forwardedEventReceived({ event: 'environmentProgress', payload: { success: true, data: op() } as never }),
        ) as Actions,
        store,
      )
        .pipe(toArray())
        .subscribe((results) => {
          expect(results).toEqual([]);
          done();
        });
    });
  });

  describe('extractEnvironmentProgress', () => {
    it('should reject invalid payloads', () => {
      expect(extractEnvironmentProgress(null)).toBeNull();
      expect(extractEnvironmentProgress({ success: true, data: { foo: 1 } })).toBeNull();
      expect(extractEnvironmentProgress({ success: true, data: op() })).toEqual(op());
    });
  });

  describe('reloadAgentsOnEnvironmentCreated$', () => {
    const completed = environmentProgressReceived({
      clientId,
      progress: op({ status: 'completed', agentId: 'agent-new' }),
    });

    function run(entities: unknown, creating: unknown, action = completed) {
      const store = mockStore(
        new Map<unknown, unknown>([
          [selectAgentsEntities, entities],
          [selectAgentsCreating, creating],
        ]),
      );

      return reloadAgentsOnEnvironmentCreated$(of(action) as Actions, store).pipe(toArray());
    }

    it('should reload the list for environments created elsewhere', (done) => {
      run({ [clientId]: [{ id: 'agent-1' }] }, {}).subscribe((results) => {
        expect(results).toEqual([loadClientAgents({ clientId })]);
        done();
      });
    });

    it('should skip while the current session is creating', (done) => {
      run({ [clientId]: [] }, { [clientId]: true }).subscribe((results) => {
        expect(results).toEqual([]);
        done();
      });
    });

    it('should skip known environments and non-create operations', (done) => {
      run({ [clientId]: [{ id: 'agent-new' }] }, {}).subscribe((known) => {
        expect(known).toEqual([]);
        run(
          {},
          {},
          environmentProgressReceived({ clientId, progress: op({ operation: 'update', status: 'completed' }) }),
        ).subscribe((update) => {
          expect(update).toEqual([]);
          done();
        });
      });
    });
  });

  describe('reloadAgentsRailOnEnvironmentCreated$', () => {
    const query = { limit: 25, offset: 0 };
    const completed = environmentProgressReceived({
      clientId,
      progress: op({ status: 'completed', agentId: 'agent-new' }),
    });

    function run(railPage: unknown, creating: unknown = {}, action = completed) {
      const store = mockStore(
        new Map<unknown, unknown>([
          [selectAgentsRailPage, railPage],
          [selectAgentsCreating, creating],
        ]),
      );

      return reloadAgentsRailOnEnvironmentCreated$(of(action) as Actions, store).pipe(toArray());
    }

    it('silently reloads the listed rail page when the new environment is not on it', (done) => {
      run({ ...initialAgentsRailPageState, clientId, query, rows: [{ id: 'agent-1' }] }).subscribe((results) => {
        expect(results).toEqual([loadClientAgentsRailPage({ clientId, query, silent: true })]);
        done();
      });
    });

    it('skips when the environment is already on the page, another workspace is listed or a create runs', (done) => {
      const listed = { ...initialAgentsRailPageState, clientId, query, rows: [{ id: 'agent-new' }] };

      run(listed)
        .pipe(toArray())
        .subscribe(([alreadyListed]) => {
          expect(alreadyListed).toEqual([]);
          run({ ...initialAgentsRailPageState, clientId: 'other', query }).subscribe((otherWorkspace) => {
            expect(otherWorkspace).toEqual([]);
            run({ ...initialAgentsRailPageState, clientId, query }, { [clientId]: true }).subscribe((creating) => {
              expect(creating).toEqual([]);
              done();
            });
          });
        });
    });

    it('skips before the rail requested a page and for running operations', (done) => {
      run({ ...initialAgentsRailPageState, clientId }).subscribe((noQuery) => {
        expect(noQuery).toEqual([]);
        run(
          { ...initialAgentsRailPageState, clientId, query },
          {},
          environmentProgressReceived({ clientId, progress: op() }),
        ).subscribe((running) => {
          expect(running).toEqual([]);
          done();
        });
      });
    });
  });
});
