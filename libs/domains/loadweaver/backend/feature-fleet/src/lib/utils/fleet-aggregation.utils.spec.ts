import type { FleetClusterHealth } from '../entities/fleet-cluster.entity';
import {
  buildFleetCard,
  compareClusters,
  compareFleetVersions,
  fleetSites,
  mergeInbox,
  snapshotAsOf,
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
      link: '/clusters/a',
      limited: false,
    });
  });

  it('withholds aggregates from project-only grants', () => {
    const card = buildFleetCard(cluster('a', 'eu'), snapshot, true);

    expect(card).toMatchObject({ limited: true, health: null, nodes: null, pendingPlans: null, version: '1.4.0' });
  });

  describe('unreachable / read-only clusters (3.43, 2026-10-31)', () => {
    const readOnly: FleetClusterHealth = {
      ...healthy,
      database: { readOnly: true, reason: 'members down', freeze: null, takenOverAt: '2026-10-20T09:55:00Z' },
    };

    it('marks the availability on the card', () => {
      expect(buildFleetCard(cluster('a', 'eu'), snapshot, false).availability.state).toBe('reachable');
      expect(buildFleetCard(cluster('a', 'eu', readOnly), snapshot, false)).toMatchObject({
        availability: { state: 'read-only', reason: 'members down', takenOverAt: '2026-10-20T09:55:00Z' },
        asOf: null,
        capacity: { cpu: { percent: 25 } },
      });
      expect(buildFleetCard(cluster('a', 'eu', readOnly), null, true).availability.state).toBe('read-only');
    });

    it('shows an unreachable cluster’s counts "as of" its last snapshot, without capacity', () => {
      const unreachable = { ...healthy, state: 'unreachable' as const, error: 'ECONNREFUSED' };
      const card = buildFleetCard(cluster('a', 'eu', unreachable), snapshot, false);

      expect(card).toMatchObject({
        availability: { state: 'unreachable', reason: 'ECONNREFUSED' },
        asOf: snapshot.fetchedAt,
        health: { state: 'at-risk' },
        nodes: { total: 5, up: 4 },
        openAlerts: 3,
        capacity: null,
      });
    });

    it('marks an overview kept from an earlier fetch "as of" then (also while the poll says reachable)', () => {
      const kept = { ...snapshot, overviewAt: '2026-10-20T09:00:00Z', errors: ['overview: unreachable'] };

      expect(snapshotAsOf(healthy, kept)).toBe('2026-10-20T09:00:00Z');
      expect(buildFleetCard(cluster('a', 'eu'), kept, false)).toMatchObject({ asOf: kept.overviewAt, capacity: null });
      expect(snapshotAsOf(healthy, { ...snapshot, overviewAt: snapshot.fetchedAt })).toBeNull();
      expect(snapshotAsOf({ state: 'unreachable' }, { ...snapshot, overview: null })).toBeNull();
    });

    it('adds a critical inbox item per read-only cluster', () => {
      const items = mergeInbox([{ cluster: { id: 'a', name: 'eu' }, health: readOnly, inbox: [] }]);

      expect(items).toEqual([
        expect.objectContaining({
          kind: 'read-only',
          severity: 'critical',
          title: 'Cluster eu is read-only: members down',
          link: '/clusters/a',
          since: healthy.checkedAt,
        }),
      ]);
    });
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
    // Everything but approvals on an untrusting cluster is resolved in the fleet (2026-10-29): no native link.
    expect(items[1].nativeUrl).toBeNull();
    expect(items[3].nativeUrl).toBeNull();
  });

  it('links approvals natively only while the cluster doesn’t trust the fleet; trust problems as items (2026-10-29)', () => {
    const approval = [{ kind: 'approval', severity: 'warning', title: 'Plan x waits', link: '/plans/x' }];
    const untrusted: FleetClusterHealth = {
      ...healthy,
      identity: 'untrusted',
      identityReason: 'fleet f is not trusted by this cluster',
      trust: {
        state: 'forbidden',
        at: '2026-10-29T09:00:00Z',
        via: 'service-credential',
        by: null,
        reason: 'the fleet’s credential for this cluster may not manage trusted fleets',
        credentialHint: '…x',
      },
    };
    const items = mergeInbox([
      { cluster: { id: 'a', name: 'eu', endpoint: 'https://eu.example.com' }, health: untrusted, inbox: approval },
      {
        cluster: { id: 'b', name: 'us', endpoint: 'https://us.example.com' },
        health: { ...healthy, identity: 'verified' },
        inbox: approval,
      },
      // Not tried yet (automatic trust runs after the next check): no item.
      {
        cluster: { id: 'c', name: 'ap', endpoint: 'https://ap.example.com' },
        health: { ...untrusted, trust: null },
        inbox: [],
      },
    ]);

    expect(items.map((i) => [i.clusterName, i.kind, i.nativeUrl])).toEqual([
      ['eu', 'trust', null],
      ['eu', 'approval', 'https://eu.example.com/plans/x'],
      ['us', 'approval', null],
    ]);
    expect(items[0]).toMatchObject({
      title: "Cluster eu doesn't trust this fleet yet",
      link: '/fleet/clusters/a',
      severity: 'warning',
    });
    expect(
      mergeInbox([
        {
          cluster: { id: 'a', name: 'eu' },
          health: { ...untrusted, trust: { ...untrusted.trust!, state: 'revoked' } },
          inbox: [],
        },
      ])[0].title,
    ).toBe('Cluster eu no longer trusts this fleet');
  });

  it('reports "Not in effect" (trust in place, the credential carries no identities) as a trust item (2026-10-29)', () => {
    const items = mergeInbox([
      {
        cluster: { id: 'a', name: 'eu', endpoint: 'https://eu.example.com' },
        health: {
          ...healthy,
          identity: 'untrusted',
          identityReason: 'API key fleet delegation is off on this cluster (LOADWEAVER_API_KEY_FLEET_DELEGATION)',
          trust: {
            state: 'established',
            at: '2026-10-29T09:00:00Z',
            via: 'service-credential',
            by: null,
            reason: null,
            credentialHint: '…x',
          },
        },
        inbox: [],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'trust',
      severity: 'warning',
      title: "Cluster eu ignores the fleet's identities on this connection",
      link: '/fleet/clusters/a',
      nativeUrl: null,
    });
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
