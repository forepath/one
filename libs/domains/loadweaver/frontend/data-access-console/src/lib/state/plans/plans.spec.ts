import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import type { Action } from '@ngrx/store';
import { firstValueFrom, of, Subject, take, throwError, toArray } from 'rxjs';

import { PlansService } from '../../services/plans.service';
import { ConsoleSocketService } from '../../sockets/console-socket';
import type { Plan } from '../../types/plans.types';
import {
  applyPlan,
  connectPlansLive,
  disconnectPlansLive,
  loadPlan,
  loadPlans,
  loadPlansSuccess,
  loadPlanSuccess,
  planActionFailure,
  planActionSuccess,
  planPatched,
  plansLiveConnected,
  plansSnapshotReceived,
} from './plans.actions';
import {
  loadPlans$,
  planActions$,
  plansLive$,
  reloadPlanAfterAction$,
  reloadSelectedPlanOnPatch$,
} from './plans.effects';
import { consolePlansReducer, initialConsolePlansState } from './plans.reducer';
import { selectPlanProjects } from './plans.selectors';

// The real socket service pulls in the identity lib (Keycloak, ES modules only); the effect gets a stub.
jest.mock('../../sockets/console-socket', () => ({ ConsoleSocketService: class {} }));

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'p1',
    status: 'pending',
    changes: [
      { action: 'update', kind: 'Deployment', name: 'web', project: 'shop', baseGeneration: 1, before: {}, after: {} },
    ],
    networkChanges: [],
    diagnostics: [],
    workloadChanges: [],
    failureAnalysis: null,
    deploymentStates: {},
    warnings: [],
    createdBy: 'u1',
    creatorRoles: {},
    risk: {},
    approvals: [],
    progress: null,
    resolves: null,
    error: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    appliedAt: null,
    ...overrides,
  };
}

describe('console plans state', () => {
  it('keeps REST approvals when the socket patches the open plan', () => {
    const approvals = [{ project: 'shop', userId: 'u2', createdAt: '2026-10-01T10:05:00.000Z' }];
    const opened = consolePlansReducer(
      consolePlansReducer(initialConsolePlansState, loadPlan({ id: 'p1' })),
      loadPlanSuccess({ plan: plan({ approvals }) }),
    );
    const patched = consolePlansReducer(opened, planPatched({ plan: plan({ status: 'applying' }) }));

    expect(patched.selected).toMatchObject({ status: 'applying', approvals });
    expect(patched.plans).toHaveLength(1);
  });

  it('adds plans from the snapshot newest first and records the action error', () => {
    const state = consolePlansReducer(
      consolePlansReducer(initialConsolePlansState, loadPlansSuccess({ plans: [plan()] })),
      plansSnapshotReceived({ plans: [plan({ id: 'p2', createdAt: '2026-10-02T10:00:00.000Z' })] }),
    );
    const failed = consolePlansReducer(
      consolePlansReducer(state, applyPlan({ id: 'p1', confirm: false })),
      planActionFailure({ action: 'apply', id: 'p1', error: 'blocked' }),
    );

    expect(state.plans.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(failed).toMatchObject({ acting: null, actionError: 'blocked' });
  });

  it('drops the list for other server filters but keeps it on a silent refresh', () => {
    const listed = consolePlansReducer(initialConsolePlansState, loadPlansSuccess({ plans: [plan()] }));

    expect(consolePlansReducer(listed, loadPlans({ query: { status: 'failed' } })).plans).toEqual([]);
    expect(consolePlansReducer(listed, loadPlans({ query: { limit: 100 }, silent: true })).plans).toHaveLength(1);
  });

  it('lists the touched projects', () => {
    expect(
      selectPlanProjects({ consolePlans: { ...initialConsolePlansState, plans: [plan(), plan({ id: 'p2' })] } }),
    ).toEqual(['shop']);
  });

  it('loads plans', async () => {
    const service = { list: jest.fn().mockReturnValue(of([plan()])) };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(loadPlans({ query: { limit: 20, status: 'pending', project: 'shop' } }))),
      ],
    });

    expect(await firstValueFrom(loadPlans$(TestBed.inject(Actions), service as unknown as PlansService))).toEqual(
      loadPlansSuccess({ plans: [plan()] }),
    );
    expect(service.list).toHaveBeenCalledWith({ limit: 20, status: 'pending', project: 'shop' });
  });

  it('applies with the pin confirmation and reports blockers', async () => {
    const service = {
      apply: jest.fn().mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { message: 'The plan cannot be applied yet', blockers: ['shop: approval missing'] },
            }),
        ),
      ),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(applyPlan({ id: 'p1', confirm: true })))],
    });

    expect(await firstValueFrom(planActions$(TestBed.inject(Actions), service as unknown as PlansService))).toEqual(
      planActionFailure({
        action: 'apply',
        id: 'p1',
        error: 'The plan cannot be applied yet: shop: approval missing',
      }),
    );
    expect(service.apply).toHaveBeenCalledWith('p1', true);
  });

  it('re-reads the plan after an action', async () => {
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(planActionSuccess({ action: 'approve', plan: plan() })))],
    });

    expect(await firstValueFrom(reloadPlanAfterAction$(TestBed.inject(Actions)))).toEqual(
      loadPlan({ id: 'p1', silent: true }),
    );
  });

  it('re-reads only the open pending plan on a patch', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(planPatched({ plan: plan({ id: 'other' }) }), planPatched({ plan: plan() }))),
        provideMockStore({ initialState: { consolePlans: { ...initialConsolePlansState, selectedId: 'p1' } } }),
      ],
    });

    const actions = await firstValueFrom(
      TestBed.runInInjectionContext(() => reloadSelectedPlanOnPatch$()).pipe(toArray()),
    );

    expect(actions).toEqual([loadPlan({ id: 'p1', silent: true })]);
  });

  it('streams the snapshot and patches from socket/plans until disconnected', async () => {
    const handlers: Record<string, (payload?: unknown) => void> = {};
    const socket = {
      on: jest.fn((event: string, handler: (payload?: unknown) => void) => (handlers[event] = handler)),
      removeAllListeners: jest.fn(),
      disconnect: jest.fn(),
    };
    const sockets = { open: jest.fn().mockResolvedValue(socket) };
    const actions$ = new Subject<Action>();

    TestBed.configureTestingModule({ providers: [provideMockActions(() => actions$)] });

    const result = firstValueFrom(
      plansLive$(TestBed.inject(Actions), sockets as unknown as ConsoleSocketService).pipe(take(3), toArray()),
    );

    actions$.next(connectPlansLive());
    await new Promise((resolve) => setTimeout(resolve));
    handlers['connect']();
    handlers['plansSnapshot']({ plans: [plan()] });
    handlers['planPatch']({ plan: plan({ status: 'applying' }) });

    expect(await result).toEqual([
      plansLiveConnected({ connected: true }),
      plansSnapshotReceived({ plans: [plan()] }),
      planPatched({ plan: plan({ status: 'applying' }) }),
    ]);
    expect(sockets.open).toHaveBeenCalledWith('plans');
    expect(socket.disconnect).toHaveBeenCalled();

    actions$.next(disconnectPlansLive());
  });
});
