import { matchesSelector, type Runtime } from '@forepath/loadweaver/shared/util-model';

import {
  canHoldBlockVolumes,
  eligibleNodes,
  ineligibilityReason,
  isolationFeatures,
  kvmUsable,
  runsLevel,
  runtimeAtLeastExpression,
  runtimeNodeLabels,
} from './eligibility';
import { analyzeFailures } from './failure-analysis';
import { schedule } from './schedule';
import type { SchedulerNode, SchedulerService } from './types';

/**
 * Isolation ladder (3.1) and VM placement (3.35): a service runs at exactly its level (never upgraded or
 * downgraded); the strength order only feeds selectors through derived labels; `/dev/kvm` and full VMs need usable,
 * not opted-out KVM; refuse-gated agent features are hard rules.
 */
const GiB = 1024 ** 3;
const KVM = { usable: true, optOut: false };

function node(name: string, runtimes: Runtime[], extra: Partial<SchedulerNode> = {}): SchedulerNode {
  return {
    name,
    site: 'fra1',
    labels: {},
    lifecycle: 'active',
    witness: false,
    capacity: { cpuMillis: 4000, memoryBytes: 8 * GiB },
    diskBytes: 100 * GiB,
    runtimes,
    reachable: true,
    ...extra,
  };
}

function service(runtime: Runtime, extra: Partial<SchedulerService> = {}): SchedulerService {
  return {
    id: `p/d/${runtime}`,
    project: 'p',
    replicas: 1,
    requests: { cpuMillis: 500, memoryBytes: GiB },
    runtime,
    spread: 'node',
    volumes: [],
    ...extra,
  };
}

const plain = node('plain', ['runc']);
const gvisor = node('gvisor', ['runc', 'sandboxed']);
const kvmOnly = node('kvm-only', ['runc', 'sandboxed-kvm', 'microvm'], { kvm: KVM });
const full = node('full', ['runc', 'sandboxed', 'sandboxed-kvm', 'microvm'], { kvm: KVM, virtualMachines: true });

const names = (nodes: SchedulerNode[]) => nodes.map((n) => n.name);

describe('exact isolation level', () => {
  const all = [plain, gvisor, kvmOnly, full];

  it.each([
    ['runc', ['plain', 'gvisor', 'kvm-only', 'full']],
    ['sandboxed', ['gvisor', 'full']],
    ['sandboxed-kvm', ['kvm-only', 'full']],
    ['microvm', ['kvm-only', 'full']],
  ] as const)('places %s only on nodes where that level is ready', (level, expected) => {
    expect(names(eligibleNodes(service(level), all))).toEqual(expected);
  });

  it('never upgrades a service to a stronger level', () => {
    const result = schedule({ nodes: [plain, kvmOnly], services: [service('sandboxed')] });

    expect(result.replicas).toEqual([]);
    expect(result.unschedulable).toEqual([
      {
        service: 'p/d/sandboxed',
        reason: 'no eligible node (runtime sandboxed: 0 of 2 nodes ready — plain not ready, kvm-only not ready)',
      },
    ]);
  });

  it('never downgrades a service to a weaker level, naming each node’s probe result', () => {
    const nodes = [
      node('node-1', ['runc', 'sandboxed', 'sandboxed-kvm'], {
        kvm: KVM,
        isolation: { microvm: { state: 'probe-failed', reasonCode: 'E_MICROVM_BOOT_FAILED' } },
      }),
      node('node-2', ['runc', 'sandboxed'], { kvm: { usable: true, optOut: true } }),
      node('node-3', ['runc'], { isolation: { microvm: { state: 'unsupported' } } }),
      node('node-4', ['runc'], { kvm: { usable: false, optOut: false } }),
    ];

    expect(ineligibilityReason(service('microvm'), nodes)).toBe(
      'no eligible node (runtime microvm: 0 of 4 nodes ready — node-1 E_MICROVM_BOOT_FAILED, node-2 disabled by node spec, node-3 unsupported, node-4 E_KVM_UNAVAILABLE)',
    );
  });

  it('refuses KVM levels on nodes whose capabilities say KVM is unusable or opted out (stale runtimes)', () => {
    const stale = node('stale', ['runc', 'sandboxed-kvm'], { kvm: { usable: false, optOut: false } });
    const optedOut = node('opted-out', ['runc', 'sandboxed-kvm'], { kvm: { usable: true, optOut: true } });
    const unknown = node('unknown', ['runc', 'sandboxed-kvm']);

    expect(runsLevel(stale, 'sandboxed-kvm')).toBe(false);
    expect(runsLevel(optedOut, 'sandboxed-kvm')).toBe(false);
    expect(runsLevel(unknown, 'sandboxed-kvm')).toBe(true);
    expect(runsLevel(stale, 'runc')).toBe(true);
    expect(ineligibilityReason(service('sandboxed-kvm'), [stale, optedOut])).toBe(
      'no eligible node (runtime sandboxed-kvm: 0 of 2 nodes ready — stale E_KVM_UNAVAILABLE, opted-out disabled by node spec)',
    );
  });

  it('shortens long node lists', () => {
    const nodes = Array.from({ length: 7 }, (_, i) => node(`n${i}`, ['runc']));

    expect(ineligibilityReason(service('sandboxed'), nodes)).toBe(
      'no eligible node (runtime sandboxed: 0 of 7 nodes ready — n0 not ready, n1 not ready, n2 not ready, n3 not ready, n4 not ready, 2 more)',
    );
  });

  it('moves a replica off a node that lost its level', () => {
    const result = schedule({
      nodes: [node('was-kvm', ['runc', 'sandboxed']), kvmOnly],
      services: [service('sandboxed-kvm')],
      current: {
        replicas: [{ service: 'p/d/sandboxed-kvm', replica: 'p/d/sandboxed-kvm/0', node: 'was-kvm' }],
        volumes: [],
      },
    });

    expect(result.replicas).toEqual([
      { service: 'p/d/sandboxed-kvm', replica: 'p/d/sandboxed-kvm/0', node: 'kvm-only' },
    ]);
  });

  it('explains lifecycle and selector before the level', () => {
    expect(ineligibilityReason(service('runc'), [node('c', ['runc'], { lifecycle: 'cordoned' })])).toBe(
      'no eligible node (no active node can run workloads)',
    );
    expect(ineligibilityReason(service('runc'), [])).toBe('no eligible node (no active node can run workloads)');
    expect(
      ineligibilityReason(service('microvm', { selector: { matchLabels: { tier: 'vm' } } }), [plain, gvisor]),
    ).toBe('no eligible node (selector matches none of the 2 nodes that can run workloads)');
    expect(ineligibilityReason(service('sandboxed', { selector: { names: ['plain'] } }), [plain, gvisor])).toBe(
      'no eligible node (runtime sandboxed: 0 of 1 node ready — plain not ready)',
    );
    expect(ineligibilityReason(service('runc'), [plain])).toBeNull();
  });
});

describe('"at least" selectors through derived node labels', () => {
  it('derives a ready label per level and the strongest level', () => {
    expect(runtimeNodeLabels(['runc', 'sandboxed', 'microvm'])).toEqual({
      'runtime.loadweaver.com/runc': 'ready',
      'runtime.loadweaver.com/sandboxed': 'ready',
      'runtime.loadweaver.com/microvm': 'ready',
      'loadweaver.com/runtime': 'microvm',
    });
    expect(runtimeNodeLabels([])).toEqual({});
  });

  it('expands runtime ≥ X to an In over the stronger levels', () => {
    expect(runtimeAtLeastExpression('sandboxed-kvm')).toEqual({
      key: 'loadweaver.com/runtime',
      operator: 'In',
      values: ['sandboxed-kvm', 'microvm'],
    });
    expect(runtimeAtLeastExpression('runc').values).toEqual(['runc', 'sandboxed', 'sandboxed-kvm', 'microvm']);
  });

  it('selects nodes by strength while the service keeps its own level', () => {
    const withLabels = [plain, gvisor, kvmOnly, full].map((n) => ({ ...n, labels: runtimeNodeLabels(n.runtimes) }));
    const selector = { matchExpressions: [runtimeAtLeastExpression('sandboxed-kvm')] };

    expect(names(withLabels.filter((n) => matchesSelector(selector, n)))).toEqual(['kvm-only', 'full']);

    const result = schedule({ nodes: withLabels, services: [service('runc', { replicas: 2, selector })] });

    expect(result.replicas.map((r) => r.node).sort()).toEqual(['full', 'kvm-only']);
    // Same selector, sandboxed service: only `full` has the exact level among the selected nodes.
    expect(names(eligibleNodes(service('sandboxed', { selector }), withLabels))).toEqual(['full']);
  });
});

describe('/dev/kvm pass-through', () => {
  it('needs usable KVM that is not opted out', () => {
    const nodes = [
      node('usable', ['runc'], { kvm: KVM }),
      node('opted-out', ['runc'], { kvm: { usable: true, optOut: true } }),
      node('unusable', ['runc'], { kvm: { usable: false, optOut: false } }),
      node('unknown', ['runc']),
    ];

    expect(nodes.map(kvmUsable)).toEqual([true, false, false, false]);
    expect(names(eligibleNodes(service('runc', { needsKvmDevice: true }), nodes))).toEqual(['usable']);
    expect(ineligibilityReason(service('runc', { needsKvmDevice: true }), nodes.slice(1))).toBe(
      'no eligible node (device /dev/kvm: 0 of 3 nodes with runtime runc have usable KVM — opted-out disabled by node spec, unusable KVM not usable, unknown KVM not reported)',
    );
  });

  it('needs the workload-devices agent feature, as a hard rule', () => {
    const old = node('old', ['runc'], { kvm: KVM, features: ['egress-policies'] });
    const current = node('current', ['runc'], { kvm: KVM, features: ['workload-devices'] });
    const svc = service('runc', { id: 'p/d/vmm', needsKvmDevice: true });

    expect(names(eligibleNodes(svc, [old, current]))).toEqual(['current']);
    expect(ineligibilityReason(svc, [old])).toBe(
      'no eligible node has an agent with the protocol features workload-devices (needed for runtime runc, device /dev/kvm); update the node agents',
    );

    // Unlike `requiredFeatures`, a replica already on an agent without the feature moves.
    const result = schedule({
      nodes: [old, current],
      services: [svc],
      current: { replicas: [{ service: 'p/d/vmm', replica: 'p/d/vmm/0', node: 'old' }], volumes: [] },
    });

    expect(result.replicas).toEqual([{ service: 'p/d/vmm', replica: 'p/d/vmm/0', node: 'current' }]);
  });
});

describe('refuse-gated agent features', () => {
  it.each([
    [service('runc'), []],
    [service('sandboxed'), []],
    [service('sandboxed-kvm'), ['isolation-ladder']],
    [service('microvm'), ['isolation-ladder', 'microvm']],
    [service('runc', { needsKvmDevice: true }), ['workload-devices']],
    [
      service('microvm', {
        virtualMachine: true,
        volumes: [{ id: 'p/lw-vm/db.root', sizeBytes: GiB, replicas: 2, crossSite: 'none', mode: 'block' }],
      }),
      ['isolation-ladder', 'virtual-machines', 'vm-block-volumes'],
    ],
  ])('derives the features of %#', (svc, expected) => {
    expect(isolationFeatures(svc)).toEqual(expected);
  });

  it('keeps KVM levels off agents without the isolation ladder; unknown features count as present', () => {
    const old = node('old', ['runc', 'sandboxed-kvm', 'microvm'], { kvm: KVM, features: ['isolation-ladder'] });
    const unknown = node('unknown', ['runc', 'sandboxed-kvm', 'microvm'], { kvm: KVM });

    expect(names(eligibleNodes(service('sandboxed-kvm'), [old, unknown]))).toEqual(['old', 'unknown']);
    expect(names(eligibleNodes(service('microvm'), [old, unknown]))).toEqual(['unknown']);
    expect(ineligibilityReason(service('microvm'), [old])).toBe(
      'no eligible node has an agent with the protocol features isolation-ladder, microvm (needed for runtime microvm); update the node agents',
    );
  });
});

describe('full virtual machines', () => {
  const vm = (extra: Partial<SchedulerService> = {}) =>
    service('microvm', {
      id: 'p/lw-vm/db',
      virtualMachine: true,
      requests: { cpuMillis: 2250, memoryBytes: 4 * GiB },
      ...extra,
    });

  it('needs full-VM support and usable KVM besides the microvm level', () => {
    const nodes = [
      kvmOnly,
      full,
      node('opted-out', ['runc', 'microvm'], { virtualMachines: true, kvm: { usable: true, optOut: true } }),
    ];

    expect(names(eligibleNodes(vm(), nodes))).toEqual(['full']);
    expect(
      ineligibilityReason(vm(), [kvmOnly, node('no-vm', ['runc', 'microvm'], { kvm: KVM, virtualMachines: false })]),
    ).toBe(
      'no eligible node (virtual machines: 0 of 2 nodes with runtime microvm support full VMs — kvm-only full-VM support not reported, no-vm no full-VM support)',
    );
    expect(
      ineligibilityReason(vm(), [
        node('stale', ['runc', 'microvm'], {
          kvm: { usable: true, optOut: false },
          virtualMachines: true,
          features: [],
        }),
      ]),
    ).toBe(
      'no eligible node has an agent with the protocol features isolation-ladder, virtual-machines (needed for virtual machines); update the node agents',
    );
  });

  it('keeps block-volume copies on nodes that can hold block volumes', () => {
    const disk = {
      id: 'p/lw-vm/db.root',
      sizeBytes: 20 * GiB,
      replicas: 2,
      crossSite: 'none' as const,
      mode: 'block' as const,
    };
    const nodes = [
      node('a-no-block', ['runc'], { blockVolumes: false }),
      node('b-old-agent', ['runc'], { features: ['isolation-ladder'] }),
      node('c-no-drbd', ['runc'], { drbd9: false }),
      { ...full, name: 'vm-1' },
      node('z-storage', ['runc'], {}),
    ];

    expect(nodes.map(canHoldBlockVolumes)).toEqual([false, false, false, true, true]);

    const result = schedule({ nodes, services: [vm({ volumes: [disk] })] });

    expect(result.unschedulable).toEqual([]);
    expect(result.replicas).toEqual([{ service: 'p/lw-vm/db', replica: 'p/lw-vm/db/0', node: 'vm-1' }]);
    expect(result.volumes).toEqual([
      { volume: 'p/lw-vm/db.root', primary: 'vm-1', syncReplicas: ['z-storage'], remoteReplicas: [] },
    ]);
  });

  it('explains when no VM node can hold block volumes', () => {
    const disk = {
      id: 'p/lw-vm/db.root',
      sizeBytes: GiB,
      replicas: 1,
      crossSite: 'none' as const,
      mode: 'block' as const,
    };
    const result = schedule({ nodes: [{ ...full, blockVolumes: false }], services: [vm({ volumes: [disk] })] });

    expect(result.unschedulable).toEqual([
      {
        service: 'p/lw-vm/db',
        replica: 'p/lw-vm/db/0',
        reason:
          'no eligible node can hold the block volumes its VM disks need (DRBD 9 and an agent with the protocol feature vm-block-volumes)',
      },
    ]);

    const noDrbd = schedule({ nodes: [{ ...full, drbd9: false }], services: [vm({ volumes: [disk] })] });

    expect(noDrbd.unschedulable[0].reason).toContain('DRBD 9 kernel module');
  });

  it('fails a VM over only to another VM-capable node', () => {
    const nodes = [{ ...full, name: 'vm-1' }, kvmOnly];
    const services = [vm()];
    const analysis = analyzeFailures(nodes, services, schedule({ nodes, services }));

    expect(analysis.findings).toContainEqual({
      scope: { kind: 'node', name: 'vm-1' },
      kind: 'deployment',
      subject: 'p/lw-vm/db',
      reason: 'p/lw-vm/db has no other eligible node than vm-1',
    });
  });
});

describe('image architectures (3.35, mixed-arch clusters)', () => {
  const amd = node('amd', ['runc', 'microvm'], { kvm: KVM, arch: 'amd64' });
  const arm = node('arm', ['runc', 'microvm'], { kvm: KVM, arch: 'arm64' });
  const unknown = node('unknown', ['runc', 'microvm'], { kvm: KVM });

  it('keeps replicas off nodes whose architecture the image lacks (unknown architectures pass)', () => {
    expect(names(eligibleNodes(service('microvm', { architectures: ['amd64'] }), [amd, arm, unknown]))).toEqual([
      'amd',
      'unknown',
    ]);
    expect(names(eligibleNodes(service('microvm', { architectures: ['amd64', 'arm64'] }), [amd, arm]))).toEqual([
      'amd',
      'arm',
    ]);
    expect(names(eligibleNodes(service('microvm'), [amd, arm]))).toEqual(['amd', 'arm']);
  });

  it('moves a replica off a node of the wrong architecture and explains an empty choice', () => {
    const svc = service('microvm', { architectures: ['arm64'] });
    const result = schedule({
      nodes: [amd, arm],
      services: [svc],
      current: { replicas: [{ service: svc.id, replica: `${svc.id}/0`, node: 'amd' }], volumes: [] },
    });

    expect(result.replicas).toEqual([{ service: svc.id, replica: `${svc.id}/0`, node: 'arm' }]);
    expect(ineligibilityReason(service('microvm', { architectures: ['arm64'] }), [amd])).toBe(
      'no eligible node (image architectures arm64: 0 of 1 node match — amd amd64)',
    );
  });
});
