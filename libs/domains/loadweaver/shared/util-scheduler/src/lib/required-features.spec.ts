import { schedule } from './schedule';
import type { SchedulerNode, SchedulerService, VolumePlacement } from './types';

/**
 * Agent features (M6 gate): services whose per-source egress settings older agents can't apply need the
 * `egress-policies` feature on their node. New replicas only go to nodes that have it; replicas already placed on an
 * older node stay (the planner warns); when no capable node fits, the replica is unschedulable with the reason.
 */
const GiB = 1024 ** 3;

function node(name: string, features: string[] | undefined, extra: Partial<SchedulerNode> = {}): SchedulerNode {
  return {
    name,
    site: 'fra1',
    labels: {},
    lifecycle: 'active',
    witness: false,
    capacity: { cpuMillis: 4000, memoryBytes: 8 * GiB },
    diskBytes: 100 * GiB,
    runtimes: ['runc'],
    reachable: true,
    ...(features ? { features } : {}),
    ...extra,
  };
}

const steered = (replicas: number, extra: Partial<SchedulerService> = {}): SchedulerService => ({
  id: 'p/d/web',
  project: 'p',
  replicas,
  requests: { cpuMillis: 500, memoryBytes: GiB },
  runtime: 'runc',
  spread: 'node',
  volumes: [],
  requiredFeatures: ['egress-policies'],
  requiredFeaturesReason: 'denyUrlPatterns',
  ...extra,
});

describe('schedule (required agent features)', () => {
  it('places new replicas only on nodes advertising the feature', () => {
    const result = schedule({
      nodes: [node('n1', []), node('n2', ['egress-policies']), node('n3', ['egress-policies', 'live-migration'])],
      services: [steered(2)],
    });

    expect(result.replicas.map((r) => r.node).sort()).toEqual(['n2', 'n3']);
    expect(result.unschedulable).toEqual([]);
  });

  it('refuses a replica that only an older agent could take, naming the feature and why', () => {
    const result = schedule({
      nodes: [node('n1', []), node('n2', ['egress-policies'], { capacity: { cpuMillis: 600, memoryBytes: 8 * GiB } })],
      services: [steered(2)],
    });

    expect(result.replicas).toEqual([{ service: 'p/d/web', replica: 'p/d/web/0', node: 'n2' }]);
    expect(result.unschedulable).toEqual([
      {
        service: 'p/d/web',
        replica: 'p/d/web/1',
        reason: expect.stringMatching(/protocol feature egress-policies \(needed for denyUrlPatterns\); update/),
      },
    ]);
  });

  it('keeps a replica already running on an older node (no forced move)', () => {
    const result = schedule({
      nodes: [node('n1', []), node('n2', ['egress-policies'])],
      services: [steered(1)],
      current: { replicas: [{ service: 'p/d/web', replica: 'p/d/web/0', node: 'n1' }], volumes: [] },
    });

    expect(result.replicas).toEqual([{ service: 'p/d/web', replica: 'p/d/web/0', node: 'n1' }]);
  });

  it('treats unknown features as present and leaves services without requirements alone', () => {
    const unknown = schedule({ nodes: [node('n1', undefined)], services: [steered(1)] });
    const plain = schedule({
      nodes: [node('n1', [])],
      services: [steered(1, { requiredFeatures: undefined })],
    });

    expect(unknown.replicas.map((r) => r.node)).toEqual(['n1']);
    expect(plain.replicas.map((r) => r.node)).toEqual(['n1']);
  });

  it('keeps capacity shortages as capacity reasons', () => {
    const result = schedule({
      nodes: [node('n1', ['egress-policies'], { capacity: { cpuMillis: 100, memoryBytes: GiB } })],
      services: [steered(1)],
    });

    expect(result.unschedulable[0].reason).toBe('not enough free capacity on eligible nodes');
  });

  describe('stateful services', () => {
    const db = steered(1, {
      id: 'p/d/db',
      volumes: [{ id: 'p/d/data', sizeBytes: 5 * GiB, replicas: 2, crossSite: 'none' }],
    });

    it('puts a new volume primary on a capable node', () => {
      const result = schedule({ nodes: [node('n1', []), node('n2', ['egress-policies'])], services: [db] });

      expect(result.replicas).toEqual([{ service: 'p/d/db', replica: 'p/d/db/0', node: 'n2' }]);
      expect(result.volumes[0].primary).toBe('n2');
    });

    it('refuses when only older agents hold the data, but keeps the current node', () => {
      const volume: VolumePlacement = { volume: 'p/d/data', primary: 'n1', syncReplicas: ['n3'], remoteReplicas: [] };
      const nodes = [node('n1', []), node('n2', ['egress-policies']), node('n3', [])];
      const moved = schedule({ nodes, services: [db], current: { replicas: [], volumes: [volume] } });
      const kept = schedule({
        nodes,
        services: [db],
        current: { replicas: [{ service: 'p/d/db', replica: 'p/d/db/0', node: 'n1' }], volumes: [volume] },
      });

      expect(moved.unschedulable).toEqual([
        { service: 'p/d/db', replica: 'p/d/db/0', reason: expect.stringContaining('egress-policies') },
      ]);
      expect(kept.replicas).toEqual([{ service: 'p/d/db', replica: 'p/d/db/0', node: 'n1' }]);
    });
  });
});
