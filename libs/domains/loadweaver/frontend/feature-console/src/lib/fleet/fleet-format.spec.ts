import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlSegment,
  UrlTree,
} from '@angular/router';
import { ConsoleEndpointService, fleetClusterSwitched } from '@forepath/loadweaver/frontend/data-access-console';
import { Store } from '@ngrx/store';

import { CONSOLE_NAV, fleetConsoleNav, FLEET_NAV_GROUP } from '../console-nav';
import {
  fleetClusterEntryGuard,
  fleetClusterLinkMatcher,
  fleetConsoleGuard,
  fleetModeOnlyGuard,
} from '../guards/fleet-mode.guard';
import {
  FLEET_ADMIN_ONLY_PATHS,
  FLEET_UNAVAILABLE_PATHS,
  fleetCapacityPercent,
  fleetCurrentStep,
  fleetLinkTarget,
  fleetOperationProgress,
  isFleetLevelPath,
  isFleetUnavailablePath,
  projectSite,
} from './fleet-format';
import { outlinePath, WORLD_OUTLINES } from './fleet-world-map.component';

const CLUSTER = '6f1c1b0e-0000-4000-8000-000000000001';

describe('fleet format', () => {
  it('splits fleet links into cluster and path', () => {
    expect(fleetLinkTarget(`/clusters/${CLUSTER}/overview`)).toEqual({ clusterId: CLUSTER, path: '/overview' });
    expect(fleetLinkTarget(`/clusters/${CLUSTER}/plans/p1?project=shop`)).toEqual({
      clusterId: CLUSTER,
      path: '/plans/p1?project=shop',
    });
    expect(fleetLinkTarget(`/clusters/${CLUSTER}`)).toEqual({ clusterId: CLUSTER, path: '/overview' });
    expect(fleetLinkTarget('/clusters/not-a-uuid/overview')).toBeNull();
    expect(fleetLinkTarget('/plans/p1')).toBeNull();
  });

  it('computes operation progress and the current step', () => {
    const step = (key: string, status: string) => ({ key, status }) as never;
    const op = {
      status: 'running' as const,
      steps: [
        step('validate', 'succeeded'),
        step('transfer', 'running'),
        step('restore-plan', 'pending'),
        step('apply', 'skipped'),
      ],
    };

    expect(fleetOperationProgress(op)).toBe(50);
    expect(fleetCurrentStep(op)).toBe('transfer');
    expect(fleetOperationProgress({ status: 'succeeded', steps: [] })).toBe(100);
  });

  it('reads capacity shares', () => {
    const capacity = {
      cpu: { used: 2, total: 8, percent: null },
      memory: { used: 1, total: 2, reserve: 0, percent: 50 },
    };

    expect(fleetCapacityPercent(capacity, 'cpu')).toBe(25);
    expect(fleetCapacityPercent(capacity, 'memory')).toBe(50);
    expect(fleetCapacityPercent(null, 'cpu')).toBeNull();
  });

  it('knows fleet-level and unrelayed paths', () => {
    expect(isFleetLevelPath('/de/fleet/clusters')).toBe(true);
    expect(isFleetLevelPath('/settings/tokens')).toBe(true);
    expect(isFleetLevelPath('/plans')).toBe(false);
    expect(isFleetUnavailablePath('/git/abc?x=1')).toBe(true);
    expect(isFleetUnavailablePath('/devices')).toBe(true);
    expect(isFleetUnavailablePath('/gitops')).toBe(false);
    expect(isFleetUnavailablePath('/plans')).toBe(false);
  });

  it('projects coordinates onto the map', () => {
    expect(projectSite(0, 0)).toEqual({ x: 180, y: 90 });
    expect(projectSite(50.1, 8.7)).toEqual({ x: 188.7, y: 39.9 });
    expect(projectSite(95, -200)).toEqual({ x: 0, y: 0 });
    expect(outlinePath(WORLD_OUTLINES[0]).startsWith('M12 24 ')).toBe(true);
  });

  it('builds the fleet sidebar', () => {
    expect(fleetConsoleNav(CONSOLE_NAV, false, FLEET_UNAVAILABLE_PATHS, FLEET_ADMIN_ONLY_PATHS)).toEqual([
      FLEET_NAV_GROUP,
    ]);

    const nav = fleetConsoleNav(CONSOLE_NAV, true, FLEET_UNAVAILABLE_PATHS, FLEET_ADMIN_ONLY_PATHS);
    const items = nav.flatMap((entry) => ('items' in entry ? entry.items : [entry]));

    expect(nav[0]).toBe(FLEET_NAV_GROUP);
    expect(items.find((item) => item.path === '/files')?.requires).toBe('cluster-admin');
    expect(items.some((item) => item.path === '/git')).toBe(false);
  });
});

describe('fleet routing guards', () => {
  const endpoints = { fleetMode: true, activeClusterId: jest.fn(), setActiveCluster: jest.fn() };
  const store = { dispatch: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ConsoleEndpointService, useValue: endpoints },
        { provide: Store, useValue: store },
      ],
    });
  });

  const run = (url: string) =>
    TestBed.runInInjectionContext(() =>
      fleetConsoleGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );
  const serialize = (result: unknown) =>
    result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result;

  it('fleet mode: cluster views need an active cluster, unrelayed views show the notice', () => {
    endpoints.fleetMode = true;
    endpoints.activeClusterId.mockReturnValue(null);
    expect(serialize(run('/plans'))).toBe('/fleet');
    expect(run('/fleet/clusters')).toBe(true);
    expect(run('/login')).toBe(true);

    endpoints.activeClusterId.mockReturnValue(CLUSTER);
    expect(run('/plans')).toBe(true);
    expect(serialize(run('/git/x'))).toBe('/fleet/unavailable?page=%2Fgit%2Fx');
  });

  it('single-cluster mode: unchanged, fleet routes lead to the overview', () => {
    endpoints.fleetMode = false;
    expect(run('/plans')).toBe(true);
    expect(run('/git')).toBe(true);
    expect(serialize(run('/fleet/compare'))).toBe('/overview');
    expect(serialize(TestBed.runInInjectionContext(() => fleetModeOnlyGuard({} as never, {} as never)))).toBe(
      '/overview',
    );
  });

  it('enters a cluster from a fleet link and continues inside it', () => {
    endpoints.fleetMode = true;
    endpoints.activeClusterId.mockReturnValue(null);

    const segments = ['clusters', CLUSTER, 'plans', 'p1'].map((p) => new UrlSegment(p, {}));
    const match = fleetClusterLinkMatcher(segments);

    expect(match?.posParams?.['clusterId'].path).toBe(CLUSTER);
    expect(fleetClusterLinkMatcher([new UrlSegment('clusters', {}), new UrlSegment('x', {})])).toBeNull();

    const route = {
      paramMap: { get: () => CLUSTER },
      url: segments,
      queryParams: { project: 'shop' },
    } as unknown as ActivatedRouteSnapshot;
    const result = TestBed.runInInjectionContext(() => fleetClusterEntryGuard(route, {} as RouterStateSnapshot));

    expect(serialize(result)).toBe('/plans/p1?project=shop');
    expect(endpoints.setActiveCluster).toHaveBeenCalledWith(CLUSTER);
    expect(store.dispatch).toHaveBeenCalledWith(fleetClusterSwitched({ clusterId: CLUSTER }));
  });
});
