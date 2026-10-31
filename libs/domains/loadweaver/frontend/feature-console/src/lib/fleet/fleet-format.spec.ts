import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlSegment,
  UrlTree,
} from '@angular/router';
import {
  ConsoleEndpointService,
  ConsoleFleetFacade,
  fleetClusterSwitched,
  type FleetClusterHealth,
  type FleetTrustAttempt,
} from '@forepath/loadweaver/frontend/data-access-console';
import { Store } from '@ngrx/store';

import { CONSOLE_SECTIONS, fleetClusterSections, fleetRail, FLEET_NAV_ITEMS } from '../console-nav';
import {
  fleetClusterEntryGuard,
  fleetClusterLinkMatcher,
  fleetConsoleGuard,
  fleetModeOnlyGuard,
} from '../guards/fleet-mode.guard';
import {
  FLEET_ADMIN_ONLY_PATHS,
  FLEET_UNAVAILABLE_PATHS,
  fleetAuditTarget,
  fleetCapacityPercent,
  fleetCurrentStep,
  fleetLinkTarget,
  fleetTrustView,
  fleetOperationProgress,
  fleetUnavailableReason,
  isFleetLevelPath,
  isFleetPagePath,
  isFleetUnavailablePath,
  formatCoordinates,
  projectSite,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_WIDTH,
} from './fleet-format';
import { graticulePath, outlinePath, WORLD_OUTLINES } from './fleet-world-map.component';

const CLUSTER = '6f1c1b0e-0000-4000-8000-000000000001';

describe('fleet format', () => {
  it('splits fleet links into cluster and path', () => {
    expect(fleetLinkTarget(`/clusters/${CLUSTER}/resources/cluster`)).toEqual({
      clusterId: CLUSTER,
      path: '/resources/cluster',
    });
    expect(fleetLinkTarget(`/clusters/${CLUSTER}/activity/plans/p1?project=shop`)).toEqual({
      clusterId: CLUSTER,
      path: '/activity/plans/p1?project=shop',
    });
    expect(fleetLinkTarget(`/clusters/${CLUSTER}`)).toEqual({ clusterId: CLUSTER, path: '/' });
    expect(fleetLinkTarget('/clusters/not-a-uuid/overview')).toBeNull();
    expect(fleetLinkTarget('/activity/plans/p1')).toBeNull();
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
    expect(isFleetLevelPath('/account/tokens')).toBe(true);
    expect(isFleetLevelPath('/activity/plans')).toBe(false);
    // Git connections are relayed since 2026-10-27 (full parity), linked Git accounts per person since 2026-10-29
    // (3.41); the service user's devices are not.
    expect(isFleetUnavailablePath('/delivery/git/abc?x=1')).toBe(false);
    expect(isFleetUnavailablePath('/account/git-accounts')).toBe(false);
    expect(isFleetUnavailablePath('/access/devices')).toBe(true);
    expect(isFleetUnavailablePath('/gitops')).toBe(false);
    expect(isFleetUnavailablePath('/activity/plans')).toBe(false);
    expect(isFleetPagePath('/de/fleet')).toBe(true);
    expect(isFleetPagePath('/fleet/clusters/x?tab=grants')).toBe(true);
    expect(isFleetPagePath('/fleet/unavailable?page=%2Fgit')).toBe(false);
    expect(isFleetPagePath('/fleetwide')).toBe(false);
    expect(isFleetPagePath('/account/tokens')).toBe(false);
  });

  it('lists only the decided native pages, each with its own reason', () => {
    expect([...FLEET_UNAVAILABLE_PATHS].sort()).toEqual(['/access/devices', '/settings/trusted-fleets']);

    for (const path of FLEET_UNAVAILABLE_PATHS) expect(fleetUnavailableReason(path)).toEqual(expect.any(String));

    expect(fleetUnavailableReason('/de/access/devices/x')).toContain('VPN devices');
    expect(fleetUnavailableReason('/settings/trusted-fleets')).toContain("fleet's cluster page");
    // Relayed pages (Git connections, webhooks, announcements, backup keys, nodes, …) have no notice.
    for (const path of [
      '/delivery/git',
      '/webhooks',
      '/updates/announcements',
      '/operate/backups/keys',
      '/resources/node/n1',
      '/access/members',
      '/resources/cluster',
    ])
      expect(fleetUnavailableReason(path)).toBeNull();
  });

  it('projects coordinates onto the map (plate carrée, 84° N – 60° S)', () => {
    expect([WORLD_MAP_WIDTH, WORLD_MAP_HEIGHT]).toEqual([360, 144]);
    // Longitude → x from the west edge, latitude → y from the north edge (south grows down).
    expect(projectSite(0, 0)).toEqual({ x: 180, y: 84 });
    expect(projectSite(84, -180)).toEqual({ x: 0, y: 0 });
    expect(projectSite(-60, 180)).toEqual({ x: 360, y: 144 });
    // Beyond the bounds: clamped onto the edge (the South Pole sits on the bottom edge, not off the map).
    expect(projectSite(95, -200)).toEqual({ x: 0, y: 0 });
    expect(projectSite(-90, -180)).toEqual({ x: 0, y: 144 });
    expect(outlinePath(WORLD_OUTLINES[0]).startsWith('M14 15.1 L17 14 ')).toBe(true);
    expect(outlinePath([[0, 0]])).toBe('M180 84 Z');
  });

  it('puts well-known cities on the right spot of the map', () => {
    const cities = {
      frankfurt: projectSite(50.11, 8.68),
      ashburn: projectSite(39.04, -77.49),
      singapore: projectSite(1.35, 103.82),
      saoPaulo: projectSite(-23.55, -46.63),
      sydney: projectSite(-33.87, 151.21),
      sanFrancisco: projectSite(37.77, -122.42),
    };

    expect(cities.frankfurt).toEqual({ x: 188.7, y: 33.9 });
    expect(cities.ashburn).toEqual({ x: 102.5, y: 45 });
    expect(cities.singapore).toEqual({ x: 283.8, y: 82.7 });
    expect(cities.saoPaulo).toEqual({ x: 133.4, y: 107.6 });
    expect(cities.sydney).toEqual({ x: 331.2, y: 117.9 });
    // Quadrants: Europe north-east of the map centre, the US north-west, Brazil south-west, Australia south-east.
    const centre = projectSite(0, 0);

    expect(cities.frankfurt.x > centre.x && cities.frankfurt.y < centre.y).toBe(true);
    expect(cities.ashburn.x < centre.x && cities.ashburn.y < centre.y).toBe(true);
    expect(cities.saoPaulo.x < centre.x && cities.saoPaulo.y > centre.y).toBe(true);
    expect(cities.sydney.x > centre.x && cities.sydney.y > centre.y).toBe(true);
    // West to east, and Singapore just north of the equator.
    expect(cities.sanFrancisco.x).toBeLessThan(cities.ashburn.x);
    expect(cities.ashburn.x).toBeLessThan(cities.frankfurt.x);
    expect(cities.frankfurt.x).toBeLessThan(cities.singapore.x);
    expect(cities.singapore.y).toBeLessThan(centre.y);
    expect(centre.y - cities.singapore.y).toBeCloseTo(1.3, 1);
  });

  it('draws the backdrop in the same projection as the sites', () => {
    // Graticule every 30°: 11 meridians and the parallels 60° S excluded, -30, 0, 30, 60.
    const graticule = graticulePath();

    expect(graticule.match(/M/g)).toHaveLength(11 + 4);
    expect(graticule).toContain('M30 0 L30 144');
    expect(graticule).toContain(`M0 84 L360 84`);
    // Every waypoint inside the bounds (none clamped onto the edge by accident, the date line excepted).
    for (const outline of WORLD_OUTLINES)
      for (const [lon, lat] of outline) {
        expect(Math.abs(lon)).toBeLessThanOrEqual(180);
        expect(lat).toBeLessThan(84);
        expect(lat).toBeGreaterThan(-60);
      }
  });

  it('formats coordinates for people', () => {
    expect(formatCoordinates(50.11, 8.68)).toBe('50.11° N, 8.68° E');
    expect(formatCoordinates(-33.868, -151.2)).toBe('33.87° S, 151.20° W');
  });

  it('builds the fleet rail and the cluster sections through the relay', () => {
    const context = {
      infrastructure: true,
      me: null,
      clusterAdmin: false,
      userManager: false,
      globalAdmin: false,
      patUi: false,
    };

    // The fleet root: the fleet's own pages as tiles (fleet audit for global admins only).
    expect(FLEET_NAV_ITEMS.map((item) => item.path)).toEqual([
      '/fleet',
      '/fleet/clusters',
      '/fleet/compare',
      '/fleet/operations',
      '/fleet/audit',
    ]);
    expect(fleetRail(FLEET_NAV_ITEMS, context).map((tile) => tile.path)).not.toContain('/fleet/audit');
    expect(fleetRail(FLEET_NAV_ITEMS, { ...context, globalAdmin: true }).map((tile) => tile.path)).toContain(
      '/fleet/audit',
    );
    // Compare only with at least 2 visible clusters (2026-10-28).
    expect(fleetRail(FLEET_NAV_ITEMS, context).map((tile) => tile.path)).not.toContain('/fleet/compare');
    expect(fleetRail(FLEET_NAV_ITEMS, { ...context, fleetCompare: true }).map((tile) => tile.path)).toContain(
      '/fleet/compare',
    );

    const items = fleetClusterSections(CONSOLE_SECTIONS, FLEET_UNAVAILABLE_PATHS, FLEET_ADMIN_ONLY_PATHS).flatMap(
      (section) => section.items,
    );

    expect(items.some((item) => item.path.startsWith('/fleet'))).toBe(false);
    expect(items.find((item) => item.path === '/operate/files')?.requires).toBe('cluster-admin');
    expect(items.some((item) => item.path === '/delivery/git')).toBe(true);
    expect(items.some((item) => item.path === '/access/devices')).toBe(false);
  });
});

describe('fleet audit targets (D11, LW-26)', () => {
  const CLUSTER = '7680708a-a67e-418c-b501-d6cbf9a2aed6';
  const name = (id: string) => (id === CLUSTER ? 'local' : 'other');

  it('shows cluster names and hides ids', () => {
    expect(fleetAuditTarget(`cluster/${CLUSTER}`, name)).toBe('local');
    expect(fleetAuditTarget(`cluster/${CLUSTER}/api/plans/${CLUSTER}/apply`, name)).toBe('local › plans/…/apply');
    expect(fleetAuditTarget(`cluster/${CLUSTER}/socket/terminals`, name)).toBe('local › terminals');
    expect(fleetAuditTarget(`operation/${CLUSTER}`, name)).toBe('Operation');
    expect(fleetAuditTarget('identity/key/abc', name)).toBe('Identity key');
    expect(fleetAuditTarget('grant/1', name)).toBe('grant/1');
  });
});

describe('fleet routing guards', () => {
  const endpoints = { fleetMode: true, activeClusterId: jest.fn(), setActiveCluster: jest.fn() };
  const store = { dispatch: jest.fn() };
  const fleet = { leaveCluster: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ConsoleEndpointService, useValue: endpoints },
        { provide: Store, useValue: store },
        { provide: ConsoleFleetFacade, useValue: fleet },
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
    expect(serialize(run('/activity/plans'))).toBe('/fleet');
    expect(run('/fleet/clusters')).toBe(true);
    expect(run('/login')).toBe(true);

    endpoints.activeClusterId.mockReturnValue(CLUSTER);
    expect(run('/activity/plans')).toBe(true);
    expect(serialize(run('/access/devices/x'))).toBe('/fleet/unavailable?page=%2Faccess%2Fdevices%2Fx');
    // Git connections belong to the cluster view (2026-10-27).
    expect(run('/delivery/git/x')).toBe(true);
  });

  it('fleet mode: entering a fleet page closes the open cluster, like the switcher', () => {
    endpoints.fleetMode = true;
    endpoints.activeClusterId.mockReturnValue(CLUSTER);

    expect(run('/activity/plans')).toBe(true);
    expect(run('/account/tokens')).toBe(true);
    expect(serialize(run('/access/devices/x'))).toBe('/fleet/unavailable?page=%2Faccess%2Fdevices%2Fx');
    // Git connections belong to the cluster view (2026-10-27).
    expect(run('/delivery/git/x')).toBe(true);
    // The notice for a cluster view belongs to the open cluster.
    expect(run('/fleet/unavailable?page=%2Faccess%2Fdevices%2Fx')).toBe(true);
    expect(fleet.leaveCluster).not.toHaveBeenCalled();

    expect(run('/fleet/compare')).toBe(true);
    expect(fleet.leaveCluster).toHaveBeenCalledTimes(1);
    expect(run('/de/fleet')).toBe(true);
    expect(fleet.leaveCluster).toHaveBeenCalledTimes(2);
  });

  it('single-cluster mode: unchanged, fleet routes lead to the landing page', () => {
    endpoints.fleetMode = false;
    expect(run('/activity/plans')).toBe(true);
    expect(run('/delivery/git')).toBe(true);
    expect(serialize(run('/fleet/compare'))).toBe('/');
    expect(serialize(TestBed.runInInjectionContext(() => fleetModeOnlyGuard({} as never, {} as never)))).toBe('/');
  });

  it('enters a cluster from a fleet link and continues inside it', () => {
    endpoints.fleetMode = true;
    endpoints.activeClusterId.mockReturnValue(null);

    const segments = ['clusters', CLUSTER, 'activity', 'plans', 'p1'].map((p) => new UrlSegment(p, {}));
    const match = fleetClusterLinkMatcher(segments);

    expect(match?.posParams?.['clusterId'].path).toBe(CLUSTER);
    expect(fleetClusterLinkMatcher([new UrlSegment('clusters', {}), new UrlSegment('x', {})])).toBeNull();

    const route = {
      paramMap: { get: () => CLUSTER },
      url: segments,
      queryParams: { project: 'shop' },
    } as unknown as ActivatedRouteSnapshot;
    const result = TestBed.runInInjectionContext(() => fleetClusterEntryGuard(route, {} as RouterStateSnapshot));

    expect(serialize(result)).toBe('/activity/plans/p1?project=shop');
    expect(endpoints.setActiveCluster).toHaveBeenCalledWith(CLUSTER);
    expect(store.dispatch).toHaveBeenCalledWith(fleetClusterSwitched({ clusterId: CLUSTER }));
  });
});

describe('fleetTrustView: one trust state from the health record (2026-10-29)', () => {
  const attempt = (state: FleetTrustAttempt['state'], at: string, over: Partial<FleetTrustAttempt> = {}) =>
    ({ state, at, via: 'service-credential', by: 'u-admin', reason: null, ...over }) as FleetTrustAttempt;
  const health = (over: Partial<FleetClusterHealth>): FleetClusterHealth => ({
    state: 'healthy',
    checkedAt: '2026-10-29T16:00:00.000Z',
    latencyMs: 20,
    version: null,
    clusterId: 'cl-1',
    error: null,
    ...over,
  });

  it('established + verified: Trusted since …, the attempt is a plain past success', () => {
    const view = fleetTrustView(
      health({
        identity: 'verified',
        identitySince: '2026-10-29T15:50:01.000Z',
        identityCheckedAt: '2026-10-29T15:50:01.000Z',
        trust: attempt('established', '2026-10-29T15:50:00.000Z'),
      }),
    );

    expect(view).toMatchObject({
      state: 'trusted',
      label: 'Trusted',
      tone: 'success',
      since: '2026-10-29T15:50:01.000Z',
      reason: null,
      establishable: false,
    });
    expect(view.attempt).toMatchObject({
      label: 'Trust established',
      tone: 'success',
      by: 'u-admin',
      superseded: false,
    });
  });

  it('established + stale health (the cluster has not answered since): pending, never "Not trusted"', () => {
    const view = fleetTrustView(
      health({
        identity: 'untrusted',
        identityReason: 'fleet fleet-1 is not trusted by this cluster',
        identityCheckedAt: '2026-10-29T15:40:00.000Z',
        trust: attempt('established', '2026-10-29T15:50:00.000Z', { by: null }),
      }),
    );

    expect(view).toMatchObject({ state: 'pending', tone: 'neutral', reason: null, establishable: false });
    expect(view.label).toContain('not confirmed');
    expect(view.attempt).toMatchObject({ tone: 'success', by: null, superseded: false });
  });

  it('established, then the cluster answers "not trusted": Not trusted with its reason, the attempt superseded', () => {
    const view = fleetTrustView(
      health({
        identity: 'untrusted',
        identityReason: 'fleet fleet-1 is not trusted by this cluster',
        identityCheckedAt: '2026-10-29T16:00:00.000Z',
        trust: attempt('established', '2026-10-29T15:50:00.000Z'),
      }),
    );

    expect(view).toMatchObject({
      state: 'not-trusted',
      label: 'Not trusted',
      tone: 'warning',
      reason: 'fleet fleet-1 is not trusted by this cluster',
      establishable: true,
    });
    expect(view.attempt).toMatchObject({ tone: 'neutral', superseded: true });
  });

  it('revoked after establishment: Not trusted, the revocation explains it', () => {
    const view = fleetTrustView(
      health({
        identity: 'untrusted',
        identityReason: 'fleet fleet-1 is not trusted by this cluster',
        trust: attempt('revoked', '2026-10-29T16:00:00.000Z', {
          by: null,
          reason: 'the cluster no longer trusts this fleet (removed under Trusted fleets)',
        }),
      }),
    );

    expect(view).toMatchObject({ state: 'not-trusted', reason: expect.stringContaining('no longer trusts') });
    expect(view.attempt).toMatchObject({ label: 'Removed by a cluster admin', tone: 'warning', superseded: false });
  });

  it('forbidden: Not trusted, the refusal is the reason, Establish trust stays offered', () => {
    const view = fleetTrustView(
      health({
        identity: 'untrusted',
        identityReason: 'fleet fleet-1 is not trusted by this cluster',
        trust: attempt('forbidden', '2026-10-29T15:50:00.000Z', { reason: 'the fleet’s credential may not manage' }),
      }),
    );

    expect(view).toMatchObject({
      state: 'not-trusted',
      reason: 'the fleet’s credential may not manage',
      establishable: true,
    });
    expect(view.attempt).toMatchObject({ tone: 'warning', superseded: false });
  });

  it('identity mismatch: Not trusted, the other cluster id is the reason', () => {
    const view = fleetTrustView(
      health({
        identity: 'untrusted',
        trust: attempt('identity-mismatch', '2026-10-29T15:50:00.000Z', {
          reason: 'the cluster answered as cl-2, but this connection belongs to cl-1',
        }),
      }),
    );

    expect(view.state).toBe('not-trusted');
    expect(view.reason).toContain('answered as cl-2');
    expect(view.attempt?.label).toContain('another cluster');
  });

  it('registered, but the connection’s credential can’t carry identities: Not in effect, no Establish trust', () => {
    // Credentials that still can't delegate (2026-10-29): a PAT without the scope, the API key with delegation off,
    // and every non-PAT on an older cluster.
    for (const identityReason of [
      'only PATs with fleet:on-behalf-of or the cluster API key send fleet identities',
      'API key fleet delegation is off on this cluster (LOADWEAVER_API_KEY_FLEET_DELEGATION)',
      'only PATs with fleet:on-behalf-of send fleet identities',
    ]) {
      const view = fleetTrustView(
        health({
          identity: 'untrusted',
          identityReason,
          checkedAt: '2026-10-29T16:31:00.000Z',
          trust: attempt('established', '2026-10-29T15:50:00.000Z'),
        }),
      );

      expect(view).toMatchObject({
        state: 'not-in-effect',
        tone: 'warning',
        reason: identityReason,
        establishable: false,
      });
      expect(view.label).not.toBe('Not trusted');
      expect(view.attempt).toMatchObject({ label: 'Trust established', superseded: false });
    }
  });

  it('API key connection on a cluster that lets API keys delegate (2026-10-29): the probe verifies → Trusted', () => {
    const view = fleetTrustView(
      health({
        identity: 'verified',
        identityReason: null,
        identitySince: '2026-10-29T15:50:00.000Z',
        checkedAt: '2026-10-29T16:31:00.000Z',
        trust: attempt('established', '2026-10-29T15:50:00.000Z'),
      }),
    );

    expect(view).toMatchObject({ state: 'trusted', tone: 'success', reason: null, establishable: false });
  });

  it('other ignored answers are no "Not in effect": an unknown fleet stays Not trusted', () => {
    expect(
      fleetTrustView(health({ identity: 'untrusted', identityReason: 'fleet f1 is not trusted by this cluster' }))
        .state,
    ).toBe('not-trusted');
  });

  it('while a fleet admin establishes trust, and before the first probe', () => {
    expect(fleetTrustView(health({ identity: 'untrusted' }), true)).toMatchObject({
      state: 'establishing',
      icon: 'bi-hourglass-split',
    });
    expect(fleetTrustView(health({}))).toMatchObject({ state: 'unknown', attempt: null, establishable: true });
    expect(fleetTrustView(null).state).toBe('unknown');
  });
});
