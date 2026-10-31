import {
  CLUSTER_LOCK,
  lockConflicts,
  lockScopes,
  nodeStates,
  summarize,
  type ReportingNode,
} from './apply-tracking.utils';

const NOW = Date.parse('2026-10-18T12:00:00Z');

function node(name: string, extra: Partial<ReportingNode> = {}): ReportingNode {
  return {
    name,
    appliedRevision: 4,
    lastReportRevision: 4,
    applyStatus: 'applied',
    applyError: null,
    lastReportSteps: null,
    connected: true,
    lastSeenAt: new Date(NOW - 5_000),
    ...extra,
  };
}

describe('apply tracking (3.8, 3.19)', () => {
  it('locks exactly what a plan touches, the whole cluster for the cluster resource', () => {
    expect(
      lockScopes([
        { action: 'update', kind: 'Deployment', name: 'site', project: 'shop' },
        { action: 'unchanged', kind: 'Policy', name: 'x', project: 'shop' },
        { action: 'create', kind: 'NodeGroup', name: 'edge', project: null },
      ]),
    ).toEqual(['Deployment/shop/site', 'NodeGroup//edge']);
    expect(lockScopes([{ action: 'update', kind: 'Cluster', name: 'c', project: null }])).toEqual([CLUSTER_LOCK]);
  });

  it('finds conflicting locks, lets a fix-forward take over its plan, and makes the cluster lock exclusive', () => {
    const held = [
      { scope: 'Deployment/shop/site', planId: 'a' },
      { scope: 'Policy/shop/web', planId: 'b' },
    ];

    expect(lockConflicts(['Deployment/shop/site'], held, 'c')).toEqual([held[0]]);
    expect(lockConflicts(['Deployment/shop/site'], held, 'c', 'a')).toEqual([]);
    expect(lockConflicts(['Volume/shop/data'], held, 'c')).toEqual([]);
    expect(lockConflicts([CLUSTER_LOCK], held, 'c')).toEqual(held);
    expect(lockConflicts(['Volume/shop/data'], [{ scope: CLUSTER_LOCK, planId: 'a' }], 'c')).toHaveLength(1);
  });

  it('follows each node to its target revision', () => {
    const states = nodeStates(
      [
        node('n1', { appliedRevision: 5 }),
        node('n2', { appliedRevision: 4, lastReportRevision: 5, applyStatus: 'rolled-back', applyError: 'nft failed' }),
        node('n3', { connected: false }),
        node('n4', { lastReportSteps: [{ layer: 'tunnels', status: 'applied' }] }),
        node('n5'),
      ],
      { n1: 5, n2: 5, n3: 5, n4: 5 },
      {},
      NOW,
      30_000,
    );

    expect(states).toEqual({
      n1: { state: 'applied' },
      n2: { state: 'failed', error: 'nft failed' },
      n3: { state: 'skipped' },
      n4: { state: 'pending' },
    });
    // Settled states stay settled.
    expect(
      nodeStates([node('n1', { appliedRevision: 1 })], { n1: 5 }, { n1: { state: 'applied' } }, NOW, 30_000),
    ).toEqual({
      n1: { state: 'applied' },
    });
    // A stale heartbeat counts as not connected.
    expect(
      nodeStates([node('n1', { appliedRevision: 1, lastSeenAt: new Date(NOW - 60_000) })], { n1: 5 }, {}, NOW, 30_000),
    ).toEqual({
      n1: { state: 'skipped' },
    });
  });

  it('summarizes progress, never 100 % before done', () => {
    expect(
      summarize('apply', {
        n1: { state: 'applied' },
        n2: { state: 'pending', steps: [{ layer: 'routing', status: 'failed' }] },
      }),
    ).toEqual({
      done: false,
      percent: 50,
      step: 'Applying: waiting for n2 (routing)',
    });
    expect(summarize('apply', { n1: { state: 'applied' }, n2: { state: 'failed', error: 'boom' } })).toEqual({
      done: true,
      failure: 'n2: boom',
      percent: 100,
      step: 'Applying failed on n2',
    });
    expect(summarize('rollback', {})).toEqual({ done: true, percent: 100, step: 'Rolling back done' });
  });
});
