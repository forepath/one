import {
  headline,
  healthChanges,
  healthTree,
  stateDurations,
  type HealthInput,
  type HealthNode,
} from './health-tree.utils';

const now = Date.parse('2026-10-18T12:00:00Z');
const gib = 1024 ** 3;
const n = (
  name: string,
  site: string,
  over: Partial<HealthInput['nodes'][number]> = {},
): HealthInput['nodes'][number] => ({
  name,
  site,
  lifecycle: 'active',
  connected: true,
  lastSeenAt: now - 1_000,
  controlPlane: false,
  witness: false,
  capacity: { cpuMillis: 4000, memoryBytes: 16 * gib, diskBytes: 100 * gib },
  usage: { cpuMillis: 500, memoryBytes: 2 * gib, diskBytes: 10 * gib },
  ...over,
});
const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  now,
  heartbeatTimeoutMs: 30_000,
  nodes: [
    n('n1', 'fra1', { controlPlane: true }),
    n('n2', 'fra1', { controlPlane: true }),
    n('n3', 'ber1', { controlPlane: true }),
  ],
  replicas: [
    {
      id: 'shop/store/web/0',
      project: 'shop',
      deployment: 'store',
      service: 'web',
      node: 'n1',
      state: 'running',
      cron: false,
    },
    {
      id: 'shop/store/web/1',
      project: 'shop',
      deployment: 'store',
      service: 'web',
      node: 'n3',
      state: 'running',
      cron: false,
    },
    {
      id: 'shop/store/web/2',
      project: 'shop',
      deployment: 'store',
      service: 'web',
      node: 'n2',
      state: 'running',
      cron: false,
    },
  ],
  volumes: [],
  rollbackFailed: [],
  projects: ['shop', 'empty'],
  ...over,
});
const get = (tree: HealthNode[], key: string) => tree.find((t) => t.key === key) as HealthNode;

describe('health tree', () => {
  it('is healthy when everything runs', () => {
    const tree = healthTree(base());

    expect(
      ['cluster', 'site/fra1', 'node/n1', 'project/shop', 'deployment/shop/store', 'service/shop/store/web'].map(
        (k) => get(tree, k).state,
      ),
    ).toEqual(Array(6).fill('healthy'));
    expect(get(tree, 'project/empty').state).toBe('healthy');
    expect(get(tree, 'service/shop/store/web').parent).toBe('deployment/shop/store');
  });

  it('rolls up with rules: 1 of 3 replicas down is degraded, all down is failed', () => {
    const one = healthTree(base({ replicas: base().replicas.map((r, i) => (i === 0 ? { ...r, state: 'dead' } : r)) }));

    expect(get(one, 'replica/shop/store/web/0').state).toBe('failed');
    expect(get(one, 'service/shop/store/web')).toMatchObject({
      state: 'degraded',
      reasons: [{ code: 'replicas-failed', message: '1 of 3 replicas failed', entities: ['replica/shop/store/web/0'] }],
    });
    expect(get(one, 'project/shop').state).toBe('degraded');

    const all = healthTree(base({ replicas: base().replicas.map((r) => ({ ...r, state: 'exited', exitCode: 1 })) }));

    expect(get(all, 'service/shop/store/web').state).toBe('failed');
    expect(get(all, 'deployment/shop/store').state).toBe('failed');
  });

  it('fails replicas of a down node and reports the node, site and quorum', () => {
    const tree = healthTree(
      base({ nodes: [...base().nodes.slice(0, 2), n('n3', 'ber1', { controlPlane: true, connected: false })] }),
    );

    expect(get(tree, 'node/n3').reasons[0].code).toBe('node-down');
    expect(get(tree, 'replica/shop/store/web/1').reasons[0]).toMatchObject({
      code: 'node-down',
      entities: ['node/n3'],
    });
    expect(get(tree, 'site/ber1').state).toBe('failed');
    expect(get(tree, 'cluster').reasons.map((r) => r.code)).toEqual(['quorum-reduced', 'site-down']);
    // One more member failure loses the quorum: at risk outranks the degraded site.
    expect(get(tree, 'cluster').state).toBe('at-risk');
  });

  it('loses the quorum when most voters are down', () => {
    const tree = healthTree(
      base({
        nodes: [
          n('n1', 'fra1', { controlPlane: true }),
          n('n2', 'fra1', { controlPlane: true, connected: false }),
          n('w', 'ber1', { witness: true, connected: false }),
        ],
      }),
    );

    expect(get(tree, 'cluster')).toMatchObject({ state: 'failed' });
    expect(get(tree, 'cluster').reasons[0].code).toBe('quorum-lost');
  });

  it('flags single-site services and volumes as at risk', () => {
    const tree = healthTree(
      base({
        replicas: base().replicas.map((r) => ({ ...r, node: 'n1' })),
        volumes: [
          { id: 'shop/store/db-data', primaryNode: 'n1', syncReplicas: ['n2'], remoteReplicas: [], crossSite: 'none' },
        ],
      }),
    );

    expect(get(tree, 'service/shop/store/web').reasons[0].code).toBe('single-site');
    expect(get(tree, 'volume/shop/store/db-data')).toMatchObject({
      state: 'at-risk',
      reasons: [{ message: 'volume shop/store/db-data has no replica outside fra1' }],
    });
    expect(headline([get(tree, 'cluster')])).toEqual({
      state: 'at-risk',
      message: 'At risk: volume shop/store/db-data has no replica outside fra1',
      key: 'cluster',
    });
  });

  it('degrades a volume whose primary is down but has a standby', () => {
    const tree = healthTree(
      base({
        nodes: [n('n1', 'fra1', { connected: false }), n('n2', 'ber1')],
        replicas: [],
        volumes: [
          { id: 'shop/store/db', primaryNode: 'n1', syncReplicas: ['n2'], remoteReplicas: [], crossSite: 'sync' },
        ],
      }),
    );

    expect(get(tree, 'volume/shop/store/db').state).toBe('degraded');
  });

  it('marks maintenance, full disks, missing N+1 reserve and failed rollbacks', () => {
    const tree = healthTree(
      base({
        nodes: [
          n('n1', 'fra1', {
            lifecycle: 'draining',
            usage: { cpuMillis: 0, memoryBytes: 3 * gib, diskBytes: 0 },
          }),
          n('n2', 'fra1', { usage: { cpuMillis: 0, memoryBytes: 15 * gib, diskBytes: 95 * gib } }),
          n('n3', 'ber1', { usage: { cpuMillis: 0, memoryBytes: 15 * gib, diskBytes: 10 * gib } }),
        ],
        rollbackFailed: [{ id: 'p1', projects: ['shop'] }],
      }),
    );

    expect(get(tree, 'node/n1').reasons[0].code).toBe('maintenance');
    expect(get(tree, 'node/n2').state).toBe('at-risk');
    expect(get(tree, 'node/n2').reasons.map((r) => r.code)).toEqual(['memory-full', 'disk-full']);
    expect(get(tree, 'cluster').reasons.map((r) => r.code)).toEqual(['no-n-plus-1', 'rollback-failed']);
    expect(get(tree, 'project/shop').reasons.at(-1)).toMatchObject({ code: 'rollback-failed', entities: ['plan/p1'] });
  });

  it('reports offline nodes as down, never as capacity problems from their last reports', () => {
    const full = { cpuMillis: 0, memoryBytes: 15 * gib, diskBytes: 95 * gib };
    const tree = healthTree(
      base({
        nodes: [
          n('n1', 'fra1', { connected: false, usage: full }),
          n('n2', 'fra1', { lastSeenAt: now - 3_600_000, usage: full }),
          n('n3', 'ber1'),
        ],
      }),
    );

    expect(get(tree, 'node/n1').reasons.map((r) => r.code)).toEqual(['node-down']);
    expect(get(tree, 'node/n2').reasons.map((r) => r.code)).toEqual(['node-down']);
    // Both fra1 nodes are offline: the cluster reports the site as down — and no N+1 problem from stale usage.
    expect(get(tree, 'cluster').reasons.map((r) => r.code)).toEqual(['site-down']);
  });

  it('is unknown before anything reported and lists changes', () => {
    const tree = healthTree(base({ nodes: [n('n1', 'fra1', { lastSeenAt: null })], replicas: [] }));

    expect(get(tree, 'node/n1').state).toBe('unknown');
    expect(get(tree, 'site/fra1').state).toBe('unknown');

    const changes = healthChanges(
      new Map([
        ['node/n1', 'healthy'],
        ['cluster', 'healthy'],
      ]),
      tree,
    );

    expect(changes.map((c) => [c.key, c.from, c.to])).toEqual(
      expect.arrayContaining([
        ['node/n1', 'healthy', 'unknown'],
        ['site/fra1', null, 'unknown'],
      ]),
    );
  });
});

describe('state durations', () => {
  it('adds up the time per state within the window', () => {
    expect(
      stateDurations(
        'healthy',
        [
          { at: 50, to: 'at-risk' },
          { at: 80, to: 'healthy' },
          { at: 150, to: 'failed' },
        ],
        0,
        100,
      ),
    ).toEqual({ healthy: 70, 'at-risk': 30 });
    expect(stateDurations(null, [{ at: 40, to: 'degraded' }], 0, 100)).toEqual({ degraded: 60 });
  });
});
