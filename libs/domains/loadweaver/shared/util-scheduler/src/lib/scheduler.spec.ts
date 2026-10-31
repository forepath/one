import { analyzeFailures } from './failure-analysis';
import { schedule } from './schedule';
import type { SchedulerNode, SchedulerService } from './types';

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

function service(id: string, extra: Partial<SchedulerService> = {}): SchedulerService {
  return {
    id,
    project: id.split('/')[0],
    replicas: 1,
    requests: { cpuMillis: 500, memoryBytes: GiB },
    runtime: 'runc',
    spread: 'node',
    volumes: [],
    ...extra,
  };
}

describe('schedule', () => {
  it('spreads replicas over nodes and balances load', () => {
    const result = schedule({
      nodes: [node('n1'), node('n2'), node('n3')],
      services: [service('p/d/web', { replicas: 3 })],
    });

    expect(result.replicas.map((r) => r.node).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(result.unschedulable).toEqual([]);
  });

  it('spreads across sites when asked', () => {
    const nodes = [node('a1', 'fra1'), node('a2', 'fra1'), node('b1', 'ams1')];
    const result = schedule({ nodes, services: [service('p/d/web', { replicas: 2, spread: 'site' })] });

    expect(new Set(result.replicas.map((r) => nodes.find((n) => n.name === r.node)?.site))).toEqual(
      new Set(['fra1', 'ams1']),
    );
  });

  it('respects runtime capability, selectors, lifecycle and witnesses', () => {
    const nodes = [
      node('n1'),
      node('n2', 'fra1', { runtimes: ['runc', 'sandboxed'] }),
      node('n3', 'fra1', { lifecycle: 'cordoned', runtimes: ['runc', 'sandboxed'] }),
      node('w', 'fra1', { witness: true }),
    ];
    const result = schedule({
      nodes,
      services: [
        service('p/d/agent', { runtime: 'sandboxed', replicas: 2 }),
        service('p/d/gpu', { selector: { matchLabels: { gpu: 'true' } } }),
      ],
    });

    expect(result.replicas.filter((r) => r.service === 'p/d/agent').map((r) => r.node)).toEqual(['n2', 'n2']);
    expect(result.unschedulable).toEqual([
      { service: 'p/d/gpu', reason: 'no eligible node (selector matches none of the 2 nodes that can run workloads)' },
    ]);
  });

  it('never overcommits capacity', () => {
    const result = schedule({
      nodes: [node('n1')],
      services: [service('p/d/big', { replicas: 10, requests: { cpuMillis: 1000, memoryBytes: GiB } })],
    });

    expect(result.replicas).toHaveLength(4);
    expect(result.unschedulable).toHaveLength(6);
    expect(result.allocated['n1']).toEqual({ cpuMillis: 4000, memoryBytes: 4 * GiB });
  });

  it('keeps existing placements while they stay valid', () => {
    const nodes = [node('n1'), node('n2'), node('n3')];
    const first = schedule({ nodes, services: [service('p/d/web', { replicas: 2 })] });
    const again = schedule({
      nodes,
      services: [service('p/d/web', { replicas: 2 })],
      current: { replicas: first.replicas, volumes: [] },
    });

    expect(again.replicas).toEqual(first.replicas);

    const drained = schedule({
      nodes: nodes.map((n) => (n.name === first.replicas[0].node ? { ...n, lifecycle: 'draining' as const } : n)),
      services: [service('p/d/web', { replicas: 2 })],
      current: { replicas: first.replicas, volumes: [] },
    });

    expect(drained.replicas[1]).toEqual(first.replicas[1]);
    expect(drained.replicas[0].node).not.toBe(first.replicas[0].node);
  });

  it('places stateful services with their volume primary and replicas in and across sites', () => {
    const nodes = [node('a1', 'fra1'), node('a2', 'fra1'), node('b1', 'ams1')];
    const db = service('p/d/db', {
      replicas: 2,
      volumes: [{ id: 'p/d/db-data', sizeBytes: 20 * GiB, replicas: 2, crossSite: 'async' }],
    });
    const result = schedule({ nodes, services: [db] });
    const primary = result.replicas[0].node;

    expect(result.volumes).toEqual([
      { volume: 'p/d/db-data', primary, syncReplicas: [primary === 'a1' ? 'a2' : 'a1'], remoteReplicas: ['b1'] },
    ]);
    expect(result.unschedulable).toEqual([
      { service: 'p/d/db', replica: 'p/d/db/1', reason: 'services with read-write volumes run a single replica' },
    ]);
  });
});

describe('schedule (DRBD 9 capability)', () => {
  const db = service('p/d/db', { volumes: [{ id: 'p/d/data', sizeBytes: GiB, replicas: 2, crossSite: 'async' }] });

  it('keeps volume primaries and replicas off nodes without the DRBD 9 module; unknown counts as present', () => {
    const nodes = [node('a1', 'fra1', { drbd9: false }), node('a2', 'fra1'), node('a3', 'fra1', { drbd9: true })];
    const result = schedule({ nodes, services: [db, service('p/d/web')] });

    expect(result.volumes).toEqual([{ volume: 'p/d/data', primary: 'a2', syncReplicas: ['a3'], remoteReplicas: [] }]);
    // Stateless services still use the node.
    expect(result.replicas.find((r) => r.service === 'p/d/web')?.node).toBe('a1');
  });

  it('refuses stateful services when no node has the module', () => {
    const result = schedule({ nodes: [node('a1', 'fra1', { drbd9: false })], services: [db] });

    expect(result.replicas).toEqual([]);
    expect(result.unschedulable).toEqual([
      {
        service: 'p/d/db',
        replica: 'p/d/db/0',
        reason:
          'no eligible node has the DRBD 9 kernel module its volumes need (node capability drbd9; install the Loadweaver release bundle)',
      },
    ]);
  });
});

describe('schedule (data locality on failover)', () => {
  const nodes = [node('a1', 'fra1'), node('a2', 'fra1'), node('a3', 'fra1'), node('b1', 'ams1')];
  const db = service('p/d/db', { volumes: [{ id: 'p/d/data', sizeBytes: GiB, replicas: 2, crossSite: 'async' }] });
  const current = {
    replicas: [{ service: 'p/d/db', replica: 'p/d/db/0', node: 'a1' }],
    volumes: [{ volume: 'p/d/data', primary: 'a1', syncReplicas: ['a2'], remoteReplicas: ['b1'] }],
  };

  it('promotes the synchronous replica when the primary is lost', () => {
    const lost = nodes.map((n) => (n.name === 'a1' ? { ...n, reachable: false } : n));
    const result = schedule({ nodes: lost, services: [db], current });

    expect(result.replicas).toEqual([{ service: 'p/d/db', replica: 'p/d/db/0', node: 'a2' }]);
    expect(result.volumes[0]).toMatchObject({ primary: 'a2', remoteReplicas: ['b1'] });
    expect(result.volumes[0].syncReplicas).not.toContain('a1');
  });

  it('never starts a stateful service on a node without a copy of its data', () => {
    const lost = nodes.map((n) => (['a1', 'a2', 'b1'].includes(n.name) ? { ...n, reachable: false } : n));
    const result = schedule({ nodes: lost, services: [db], current });

    expect(result.replicas).toEqual([]);
    expect(result.unschedulable).toEqual([
      {
        service: 'p/d/db',
        replica: 'p/d/db/0',
        reason: 'no eligible node holding a copy of its volumes has enough capacity',
      },
    ]);
  });
});

describe('analyzeFailures', () => {
  it('reports volumes without replicas, single-node services and missing N+1 capacity', () => {
    const nodes = [
      node('n1', 'fra1', { capacity: { cpuMillis: 1000, memoryBytes: 2 * GiB } }),
      node('n2', 'fra1', { capacity: { cpuMillis: 1000, memoryBytes: 2 * GiB } }),
    ];
    const services = [
      service('p/d/db', { volumes: [{ id: 'p/d/data', sizeBytes: GiB, replicas: 1, crossSite: 'none' }] }),
      service('p/d/pinned', { selector: { names: ['n2'] } }),
      service('p/d/web', { replicas: 2, requests: { cpuMillis: 800, memoryBytes: 1.5 * GiB } }),
    ];
    const result = schedule({ nodes, services });
    const analysis = analyzeFailures(nodes, services, result);
    const reasons = analysis.findings.map((f) => f.reason);
    const dbNode = result.replicas.find((r) => r.service === 'p/d/db')!.node;

    expect(reasons).toContain(`volume p/d/data has no replica outside ${dbNode}`);
    expect(reasons).toContain('p/d/pinned has no other eligible node than n2');
    expect(analysis.nPlusOne).toBe(false);
  });

  it('accepts a resilient setup', () => {
    const nodes = [node('n1'), node('n2'), node('n3')];
    const services = [
      service('p/d/db', { volumes: [{ id: 'p/d/data', sizeBytes: GiB, replicas: 2, crossSite: 'async' }] }),
      service('p/d/web', { replicas: 2 }),
    ];
    const result = schedule({ nodes, services });

    expect(analyzeFailures(nodes, services, result)).toEqual({ findings: [], nPlusOne: true });
  });

  it('checks whole sites when the failure domain is site', () => {
    const nodes = [node('a1', 'fra1'), node('a2', 'fra1'), node('b1', 'ams1')];
    const services = [
      service('p/d/db', { volumes: [{ id: 'p/d/data', sizeBytes: GiB, replicas: 2, crossSite: 'none' }] }),
    ];
    const result = schedule({ nodes, services });

    expect(analyzeFailures(nodes, services, result, 'node').findings).toEqual([]);
    expect(analyzeFailures(nodes, services, result, 'site').findings.map((f) => f.reason)).toContain(
      'volume p/d/data has no replica outside site fra1',
    );
  });
});
