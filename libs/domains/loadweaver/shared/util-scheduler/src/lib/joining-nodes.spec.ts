import { schedule } from './schedule';
import type { SchedulerNode, SchedulerService, VolumePlacement } from './types';

/**
 * Volume plans while a node is joining (M6 gate): a node that isn't ready (`notReady`) keeps the copies it holds,
 * gets no new ones — a sync replica there would hold the apply up until it finished initialising and the plan would
 * roll back — and the schedule says which copies were held back (the plan shows it as a note).
 */
const GiB = 1024 ** 3;

function node(name: string, site = 'fra1', extra: Partial<SchedulerNode> = {}): SchedulerNode {
  return {
    name,
    site,
    labels: {},
    lifecycle: 'active',
    witness: false,
    capacity: { cpuMillis: 4000, memoryBytes: 8 * GiB },
    diskBytes: 100 * GiB,
    runtimes: ['runc'],
    reachable: true,
    ...extra,
  };
}

const db = (replicas = 2, crossSite: 'async' | 'sync' | 'none' = 'none'): SchedulerService => ({
  id: 'p/d/db',
  project: 'p',
  replicas: 1,
  requests: { cpuMillis: 500, memoryBytes: GiB },
  runtime: 'runc',
  spread: 'node',
  volumes: [{ id: 'p/d/data', sizeBytes: 5 * GiB, replicas, crossSite }],
});
const joining = 'joining: control-plane member still initialising (applied revision 3 of 5)';

describe('schedule (volumes while nodes are joining)', () => {
  it('never places a sync replica of a new volume on a node that is not ready, and notes it', () => {
    const result = schedule({ nodes: [node('n1'), node('n2', 'fra1', { notReady: joining })], services: [db()] });

    expect(result.volumes).toEqual([{ volume: 'p/d/data', primary: 'n1', syncReplicas: [], remoteReplicas: [] }]);
    expect(result.unschedulable).toEqual([]);
    expect(result.held).toEqual([{ volume: 'p/d/data', kind: 'replica', nodes: [{ name: 'n2', reason: joining }] }]);
  });

  it('uses ready nodes for the copies and says nothing when enough are ready', () => {
    const result = schedule({
      nodes: [node('n1'), node('n2'), node('n3', 'fra1', { notReady: joining })],
      services: [db()],
    });

    expect(result.volumes[0].syncReplicas).toHaveLength(1);
    expect([result.volumes[0].primary, ...result.volumes[0].syncReplicas]).not.toContain('n3');
    expect(result.held).toBeUndefined();
  });

  it('keeps copies a not-ready node already holds (no data moves because of a restart)', () => {
    const current: VolumePlacement = { volume: 'p/d/data', primary: 'n1', syncReplicas: ['n2'], remoteReplicas: [] };
    const result = schedule({
      nodes: [node('n1'), node('n2', 'fra1', { notReady: joining })],
      services: [db()],
      current: { replicas: [{ service: 'p/d/db', replica: 'p/d/db/0', node: 'n1' }], volumes: [current] },
    });

    expect(result.volumes).toEqual([current]);
    expect(result.held).toBeUndefined();
  });

  it('holds back a remote copy on a joining node of another site', () => {
    const result = schedule({
      nodes: [node('n1'), node('b1', 'ams1', { notReady: joining })],
      services: [db(1, 'async')],
    });

    expect(result.volumes[0]).toMatchObject({ primary: 'n1', remoteReplicas: [] });
    expect(result.held).toEqual([{ volume: 'p/d/data', kind: 'replica', nodes: [{ name: 'b1', reason: joining }] }]);
  });

  it('puts the primary of a new volume on a ready node, a not-ready one only as the only fit (noted)', () => {
    const preferReady = schedule({
      // n0 sorts first and has the least load: without readiness it would be the primary.
      nodes: [node('n0', 'fra1', { notReady: joining }), node('n1')],
      services: [db(1)],
    });

    expect(preferReady.volumes[0].primary).toBe('n1');
    expect(preferReady.replicas).toEqual([{ service: 'p/d/db', replica: 'p/d/db/0', node: 'n1' }]);

    const onlyFit = schedule({ nodes: [node('n0', 'fra1', { notReady: joining })], services: [db(1)] });

    expect(onlyFit.volumes[0].primary).toBe('n0');
    expect(onlyFit.held).toEqual([{ volume: 'p/d/data', kind: 'primary', nodes: [{ name: 'n0', reason: joining }] }]);
  });

  it('leaves stateless replicas alone (only volume copies wait for readiness)', () => {
    const result = schedule({
      nodes: [node('n1'), node('n2', 'fra1', { notReady: joining })],
      services: [{ ...db(), id: 'p/d/web', replicas: 2, volumes: [] }],
    });

    expect(result.replicas.map((r) => r.node).sort()).toEqual(['n1', 'n2']);
  });
});
