// The identity barrel pulls in Keycloak (ES modules only): only its logout action is needed here.
jest.mock('@forepath/identity/frontend', () => ({
  logoutSuccess: jest.requireActual('@ngrx/store').createAction('[Authentication] Logout Success'),
}));

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { logoutSuccess } from '@forepath/identity/frontend';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, Subject, throwError, toArray } from 'rxjs';

import { ConsoleEndpointService } from '../../services/console-endpoint.service';
import { FleetService } from '../../services/fleet.service';
import type { FleetCard, FleetCluster, FleetOperation } from '../../types/fleet.types';
import { clearAccess } from '../access/access.actions';
import { consoleAccessReducer } from '../access/access.reducer';
import { resetConsoleStateOnLogout, resetFleetStateOnLogout } from '../session/console-session.meta-reducer';
import {
  cancelFleetOperationSuccess,
  createFleetOperationSuccess,
  deleteFleetClusterSuccess,
  fleetClusterSwitched,
  loadFleetAuditPage,
  loadFleetAuditPageSuccess,
  loadFleetCardsSuccess,
  loadFleetClustersSuccess,
  loadFleetGrants,
  loadFleetOverview,
  nextFleetAuditPage,
  openFleetCluster,
  pollFleetClusterSuccess,
  putFleetGrantSuccess,
  saveFleetCluster,
  saveFleetClusterFailure,
  saveFleetClusterSuccess,
  searchFleetAudit,
} from './fleet.actions';
import {
  fleetAuditPageNavigation$,
  leaveFleetClusterOnLogout$,
  loadFleetCards$,
  openFleetCluster$,
  reloadFleetGrants$,
  saveFleetCluster$,
} from './fleet.effects';
import { consoleFleetReducer, initialConsoleFleetState, type ConsoleFleetState } from './fleet.reducer';
import { selectFleetSummary } from './fleet.selectors';

const A = '6f1c1b0e-0000-4000-8000-00000000000a';
const B = '6f1c1b0e-0000-4000-8000-00000000000b';

function cluster(id: string, name: string): FleetCluster {
  return {
    id,
    name,
    description: null,
    endpoint: `https://${name}.example.com`,
    hasCustomCa: false,
    credentialHint: 'abcd',
    reference: null,
    state: 'active',
    readOnlyUntil: null,
    readOnlyReason: null,
    health: { state: 'healthy', checkedAt: null, latencyMs: 4, version: '1.2.0', clusterId: null, error: null },
    access: { clusterRole: 'admin', projects: {}, readOnly: false },
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };
}

function card(id: string, overrides: Partial<FleetCard> = {}): FleetCard {
  return {
    id,
    name: id,
    reference: null,
    state: 'active',
    readOnlyUntil: null,
    connection: { state: 'healthy', checkedAt: null, latencyMs: 1, version: '1.2.0', clusterId: null, error: null },
    health: { state: 'healthy', message: 'ok' },
    sites: 2,
    nodes: { total: 3, up: 3 },
    deployments: 4,
    capacity: null,
    version: '1.2.0',
    latestAvailable: null,
    upgradeAvailable: false,
    activeRollout: null,
    openAlerts: 1,
    pendingPlans: 2,
    inbox: { critical: 0, warning: 0, info: 0 },
    link: `/clusters/${id}/overview`,
    limited: false,
    errors: [],
    fetchedAt: null,
    ...overrides,
  };
}

function operation(id: string, status: FleetOperation['status']): FleetOperation {
  return {
    id,
    kind: 'cross-cluster-restore',
    status,
    sourceClusterId: A,
    targetClusterId: B,
    params: {},
    steps: [],
    error: null,
    createdBy: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };
}

describe('console fleet state', () => {
  it('keeps clusters sorted on register, replaces on change, drops on delete', () => {
    let state = consoleFleetReducer(
      initialConsoleFleetState,
      loadFleetClustersSuccess({ clusters: [cluster(B, 'beta')] }),
    );

    state = consoleFleetReducer(state, saveFleetCluster({ id: null, create: {} as never }));
    expect(state.saving).toBe(true);
    state = consoleFleetReducer(state, saveFleetClusterSuccess({ cluster: cluster(A, 'alpha') }));
    expect(state.clusters.map((c) => c.name)).toEqual(['alpha', 'beta']);
    expect(state.saving).toBe(false);

    state = consoleFleetReducer(
      state,
      pollFleetClusterSuccess({ id: A, health: { ...cluster(A, 'a').health, state: 'degraded' } }),
    );
    expect(state.clusters[0].health.state).toBe('degraded');

    state = consoleFleetReducer(state, saveFleetClusterFailure({ error: 'connection test failed' }));
    expect(state.saveError).toBe('connection test failed');

    state = consoleFleetReducer(state, deleteFleetClusterSuccess({ id: B }));
    expect(state.clusters.map((c) => c.id)).toEqual([A]);
  });

  it('pages the fleet audit log by the last seq', () => {
    let state = consoleFleetReducer(initialConsoleFleetState, searchFleetAudit({ filter: {}, limit: 2 }));
    const entry = (seq: string) => ({
      seq,
      at: '2026-10-20T10:00:00.000Z',
      actorType: 'user' as const,
      actorId: 'u',
      action: 'relay.request',
      clusterId: A,
      target: 't',
      details: {},
    });

    state = consoleFleetReducer(state, loadFleetAuditPage({ page: 0, before: null }));
    state = consoleFleetReducer(state, loadFleetAuditPageSuccess({ page: 0, entries: [entry('9'), entry('8')] }));
    expect(state.auditHasNext).toBe(true);
    state = consoleFleetReducer(state, loadFleetAuditPage({ page: 1, before: '8' }));
    state = consoleFleetReducer(state, loadFleetAuditPageSuccess({ page: 1, entries: [entry('7')] }));
    expect(state).toMatchObject({ auditPage: 1, auditCursors: [null, '8'], auditHasNext: false });
  });

  it('merges created / cancelled operations into the list', () => {
    let state = consoleFleetReducer(
      initialConsoleFleetState,
      createFleetOperationSuccess({ operation: operation('o1', 'running') }),
    );

    state = consoleFleetReducer(state, cancelFleetOperationSuccess({ operation: operation('o1', 'cancelled') }));
    expect(state.operations).toEqual([operation('o1', 'cancelled')]);
  });

  it('summarises the cards and inbox', () => {
    const state = {
      consoleFleet: {
        ...initialConsoleFleetState,
        cards: [
          card(A, { upgradeAvailable: true }),
          card(B, { state: 'teardown', connection: { ...card(B).connection, state: 'unreachable' } }),
        ],
        inbox: [
          {
            clusterId: A,
            clusterName: 'a',
            kind: 'alert',
            severity: 'critical' as const,
            title: 't',
            link: '/x',
            project: null,
            since: null,
          },
        ],
      },
    };

    expect(selectFleetSummary(state)).toMatchObject({
      clusters: 2,
      healthy: 1,
      unhealthy: 1,
      critical: 1,
      upgrades: 1,
      pendingPlans: 4,
      openAlerts: 2,
      teardown: 1,
    });
  });

  it('resets cluster-scoped slices on a cluster switch but keeps the fleet slice', () => {
    const access = resetConsoleStateOnLogout(consoleAccessReducer);
    const fleet = resetFleetStateOnLogout(consoleFleetReducer);
    const accessState = {
      me: { userId: null, clusterRole: 'auditor' as const, projects: {} },
      loading: false,
      error: null,
    };
    const fleetState: ConsoleFleetState = { ...initialConsoleFleetState, clusters: [cluster(A, 'a')] };

    expect(access(accessState as never, fleetClusterSwitched({ clusterId: B })).me).toBeNull();
    expect(fleet(fleetState, fleetClusterSwitched({ clusterId: B })).clusters).toHaveLength(1);
    expect(fleet(fleetState, clearAccess()).clusters).toHaveLength(0);
  });
});

describe('console fleet effects', () => {
  const service = {
    createCluster: jest.fn(),
    updateCluster: jest.fn(),
    cards: jest.fn(),
  };
  const endpoints = { activeClusterId: jest.fn(), setActiveCluster: jest.fn() };
  const router = { navigateByUrl: jest.fn().mockResolvedValue(true) };
  let actions$: Subject<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    actions$ = new Subject();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({ initialState: { consoleFleet: initialConsoleFleetState } }),
        { provide: FleetService, useValue: service },
        { provide: ConsoleEndpointService, useValue: endpoints },
        { provide: Router, useValue: router },
      ],
    });
  });

  const run = <T>(effect: () => T) => TestBed.runInInjectionContext(effect);

  it('registers or changes a connection', async () => {
    service.createCluster.mockReturnValue(of(cluster(A, 'alpha')));
    service.updateCluster.mockReturnValue(throwError(() => new Error('nope')));

    const out = firstValueFrom(run(() => saveFleetCluster$()).pipe(toArray()));

    actions$.next(saveFleetCluster({ id: null, create: { name: 'alpha', endpoint: 'https://a', credential: 'x' } }));
    actions$.next(saveFleetCluster({ id: A, update: { endpoint: 'https://b', credential: 'y'.repeat(16) } }));
    actions$.complete();

    expect(await out).toEqual([
      saveFleetClusterSuccess({ cluster: cluster(A, 'alpha') }),
      saveFleetClusterFailure({ error: 'nope' }),
    ]);
    expect(service.updateCluster).toHaveBeenCalledWith(A, { endpoint: 'https://b', credential: 'y'.repeat(16) });
  });

  it('loads the cards on the overview and reloads grants after a change', async () => {
    service.cards.mockReturnValue(of([card(A)]));

    const cards = firstValueFrom(run(() => loadFleetCards$()));

    actions$.next(loadFleetOverview());
    expect(await cards).toEqual(loadFleetCardsSuccess({ cards: [card(A)] }));

    const grants = firstValueFrom(run(() => reloadFleetGrants$()));

    actions$.next(
      putFleetGrantSuccess({
        grant: { id: 'g', clusterId: A, userId: 'u', role: 'viewer', project: null, createdBy: null, createdAt: '' },
      }),
    );
    expect(await grants).toEqual(loadFleetGrants({ clusterId: A }));
  });

  it('opens a cluster: switches the relay, resets cluster state before navigating', () => {
    const store = TestBed.inject(Store) as MockStore;
    const dispatch = jest.spyOn(store, 'dispatch');
    const order: string[] = [];

    endpoints.activeClusterId.mockReturnValue(A);
    endpoints.setActiveCluster.mockImplementation(() => order.push('set'));
    dispatch.mockImplementation(() => void order.push('switched'));
    router.navigateByUrl.mockImplementation(() => {
      order.push('navigate');

      return Promise.resolve(true);
    });

    run(() => openFleetCluster$()).subscribe();
    actions$.next(openFleetCluster({ clusterId: B, path: '/clusters-ignored/plans' }));
    expect(order).toEqual(['set', 'switched', 'navigate']);
    expect(dispatch).toHaveBeenCalledWith(fleetClusterSwitched({ clusterId: B }));

    // Same cluster: only navigates.
    order.length = 0;
    endpoints.activeClusterId.mockReturnValue(B);
    actions$.next(openFleetCluster({ clusterId: B, path: 'plans' }));
    expect(order).toEqual(['navigate']);
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/plans');
  });

  it('leaves the active cluster on logout', () => {
    run(() => leaveFleetClusterOnLogout$()).subscribe();
    actions$.next(logoutSuccess());
    expect(endpoints.setActiveCluster).toHaveBeenCalledWith(null);
  });

  it('pages the audit log with the last seq of the current page', async () => {
    const store = TestBed.inject(Store) as MockStore;

    store.setState({
      consoleFleet: {
        ...initialConsoleFleetState,
        auditFilter: {},
        auditHasNext: true,
        auditEntries: [{ seq: '9' }, { seq: '8' }],
      },
    });

    const out = firstValueFrom(run(() => fleetAuditPageNavigation$()));

    actions$.next(nextFleetAuditPage());
    expect(await out).toEqual(loadFleetAuditPage({ page: 1, before: '8' }));
  });
});
