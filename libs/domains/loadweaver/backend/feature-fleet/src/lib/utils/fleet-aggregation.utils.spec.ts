import type { FleetClusterHealth } from '../entities/fleet-cluster.entity';
import {
  buildFleetCard,
  compareClusters,
  compareFleetVersions,
  fleetSites,
  mergeInbox,
  specHash,
  type ClusterSnapshot,
} from './fleet-aggregation.utils';

const healthy: FleetClusterHealth = {
  state: 'healthy',
  checkedAt: '2026-10-20T10:00:00Z',
  latencyMs: 12,
  version: '1.4.0',
  clusterId: 'c-1',
  error: null,
};
const cluster = (id: string, name: string, health = healthy) => ({
  id,
  name,
  reference: null,
  state: 'active',
  readOnlyUntil: null,
  health,
});
const snapshot: ClusterSnapshot = {
  overview: {
    headline: { state: 'at-risk', message: 'volume db has no replica outside fra1' },
    inbox: [
      { kind: 'alert', severity: 'warning', title: 'CPU high', link: '/alerts', since: '2026-10-20T09:00:00Z' },
      {
        kind: 'rollback-failed',
        severity: 'critical',
        title: 'Rollback failed',
        link: '/plans/x',
        since: '2026-10-20T09:30:00Z',
      },
    ],
    summary: {
      sites: 2,
      nodes: { total: 5, up: 4 },
      deployments: 12,
      capacity: { cpuMillis: { used: 2000, total: 8000 }, memoryBytes: { used: 4, total: 16, reserve: 2 } },
      alertsFiring: 3,
    },
  },
  updates: { clusterVersion: '1.4.0', latestAvailable: '1.5.1', activeRollout: null },
  pendingPlans: 2,
  sites: [
    {
      kind: 'Site',
      metadata: { name: 'fra1' },
      spec: { location: { latitude: 50.1, longitude: 8.7, label: 'Frankfurt' } },
    },
    { kind: 'Site', metadata: { name: 'lab' }, spec: {} },
  ],
  errors: [],
  fetchedAt: '2026-10-20T10:00:01Z',
};

describe('fleet aggregation (3.25)', () => {
  it('builds a card from the cluster overview, updates and plans', () => {
    const card = buildFleetCard(cluster('a', 'eu'), snapshot, false);

    expect(card).toMatchObject({
      health: { state: 'at-risk' },
      sites: 2,
      nodes: { total: 5, up: 4 },
      capacity: { cpu: { percent: 25 }, memory: { percent: 25, reserve: 2 } },
      version: '1.4.0',
      latestAvailable: '1.5.1',
      upgradeAvailable: true,
      openAlerts: 3,
      pendingPlans: 2,
      inbox: { critical: 1, warning: 1, info: 0 },
      link: '/clusters/a/overview',
      limited: false,
    });
  });

  it('withholds aggregates from project-only grants', () => {
    const card = buildFleetCard(cluster('a', 'eu'), snapshot, true);

    expect(card).toMatchObject({ limited: true, health: null, nodes: null, pendingPlans: null, version: '1.4.0' });
  });

  it('compares versions', () => {
    expect(compareFleetVersions('1.4.0', '1.10.0')).toBe(-1);
    expect(compareFleetVersions('v2.0.0', '1.9.9')).toBe(1);
    expect(compareFleetVersions('1.2.3', '1.2.3-rc.1')).toBe(0);
  });

  it('merges inboxes across clusters: critical first, oldest first, unreachable clusters as items', () => {
    const items = mergeInbox([
      {
        cluster: { id: 'a', name: 'eu', endpoint: 'https://eu.example.com' },
        health: healthy,
        inbox: snapshot.overview?.inbox ?? [],
      },
      {
        cluster: { id: 'b', name: 'us' },
        health: { ...healthy, state: 'unreachable', checkedAt: '2026-10-20T08:00:00Z' },
        inbox: null,
      },
      {
        cluster: { id: 'c', name: 'ap' },
        health: healthy,
        inbox: [{ kind: 'drift', severity: 'bogus', title: 'Drift', link: 'javascript:alert(1)' }],
      },
    ]);

    expect(items.map((i) => [i.clusterName, i.kind, i.severity])).toEqual([
      ['us', 'connection', 'critical'],
      ['eu', 'rollback-failed', 'critical'],
      ['eu', 'alert', 'warning'],
      ['ap', 'drift', 'info'],
    ]);
    expect(items[1].link).toBe('/clusters/a/plans/x');
    expect(items[3].link).toBe('/clusters/c/');
    // Approvals stay native: the cluster's own console page for the same item.
    expect(items[1].nativeUrl).toBe('https://eu.example.com/plans/x');
    expect(items[3].nativeUrl).toBeNull();
  });

  it('places sites with a location on the map', () => {
    expect(fleetSites([{ cluster: { id: 'a', name: 'eu' }, sites: snapshot.sites }])).toEqual({
      sites: [{ clusterId: 'a', clusterName: 'eu', site: 'fra1', latitude: 50.1, longitude: 8.7, label: 'Frankfurt' }],
      withoutLocation: 1,
    });
  });

  it('compares clusters side by side with a policy drift summary', () => {
    const policy = (name: string, spec: unknown, project: string | null = null) => ({
      kind: 'Policy',
      metadata: { name, project },
      spec,
    });
    const a = buildFleetCard(cluster('a', 'eu'), snapshot, false);
    const b = buildFleetCard(cluster('b', 'us'), { ...snapshot, updates: { clusterVersion: '1.5.1' } }, false);
    const result = compareClusters([
      {
        cluster: { id: 'a', name: 'eu' },
        card: a,
        policies: [policy('web', { allow: ['a', 'b'] }), policy('db', { x: 1 }), policy('only-a', {})],
      },
      {
        cluster: { id: 'b', name: 'us' },
        card: b,
        policies: [
          policy('web', { allow: ['a', 'b'] }),
          policy('db', { x: 2 }),
          { kind: 'Deployment', metadata: { name: 'x' } },
        ],
      },
    ]);

    expect(result.sameVersion).toBe(false);
    expect(result.versions).toEqual([
      { clusterId: 'a', version: '1.4.0', latestAvailable: '1.5.1' },
      { clusterId: 'b', version: '1.5.1', latestAvailable: null },
    ]);
    expect(result.policyDrift).toMatchObject({ identical: 1, missing: 1, different: 1 });
    expect(result.policyDrift.items.map((i) => [i.name, i.state])).toEqual([
      ['db', 'different'],
      ['only-a', 'missing'],
    ]);
    expect(result.policyDrift.items[1].clusters['b']).toBeNull();
  });

  it('hashes specs independent of key order', () => {
    expect(specHash({ a: 1, b: { c: 2, d: 3 } })).toBe(specHash({ b: { d: 3, c: 2 }, a: 1 }));
    expect(specHash({ a: [1, 2] })).not.toBe(specHash({ a: [2, 1] }));
  });
});
