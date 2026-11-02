import { workloadSpecSchema } from '@forepath/loadweaver/shared/util-agent-protocol';
import { projectSpecSchema, type ProjectSpec } from '@forepath/loadweaver/shared/util-model';
import { schedule, type SchedulerNode } from '@forepath/loadweaver/shared/util-scheduler';

import { MICROVM_LAUNCHER_OVERHEAD } from './microvm-planning.utils';
import {
  buildWorkloadSpec,
  replicaAgentFeatures,
  toSchedulerNodes,
  toSchedulerServices,
  translateDeployments,
  type PlannerNode,
} from './workload-planning.utils';

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const DIGEST = `sha256:${'a'.repeat(64)}`;

/**
 * M7 W3: the isolation ladder in the planner — exact levels per node, `/dev/kvm` allowances, microVM requests and the
 * spec hash stability of the old levels.
 */

const COMPOSE = `
services:
  web:
    image: nginx:1.27
    command: [nginx, -g, 'daemon off;']
    environment: { A: b }
    healthcheck: { test: [CMD, curl, -f, http://localhost], interval: 10s }
    deploy: { resources: { limits: { cpus: '2', memory: 1g }, reservations: { cpus: '0.5', memory: 256m } } }
  sandbox:
    image: alpine:3
    x-loadweaver: { runtime: sandboxed }
`;

const LADDER = `
services:
  plain: { image: alpine:3 }
  gvisor: { image: alpine:3, x-loadweaver: { runtime: sandboxed } }
  gvisorkvm: { image: alpine:3, x-loadweaver: { runtime: sandboxed-kvm } }
  vm:
    image: alpine:3
    x-loadweaver: { runtime: microvm }
    deploy: { resources: { limits: { cpus: '1.5', memory: 1g }, reservations: { cpus: '0.5', memory: 256m } } }
  kvm:
    image: alpine:3
    devices: [/dev/kvm]
`;

const allowKvm = projectSpecSchema.parse({ workloads: { allowedDevices: ['/dev/kvm'] } });

function parse(compose: string, project: ProjectSpec = allowKvm) {
  return translateDeployments([{ project: 'shop', name: 'store', spec: { compose } }], new Map([['shop', project]]));
}

function node(name: string, overrides: Partial<PlannerNode> = {}): PlannerNode {
  return {
    name,
    site: 's',
    labels: {},
    lifecycle: 'active',
    witness: false,
    controlPlane: false,
    capacity: { cpuMillis: 16_000, memoryBytes: 64 * GiB, diskBytes: 500 * GiB },
    runtimes: ['runc'],
    reachable: true,
    ...overrides,
  };
}

const kvm = { usable: true, optOut: false };

describe('isolation planning (M7 W3)', () => {
  it('keeps the spec hash of plain runc and sandboxed services (M7 0.2)', () => {
    const { parsed } = parse(COMPOSE);
    const d = parsed[0];
    const hash = (name: string) =>
      buildWorkloadSpec(d, d.compose.services.find((s) => s.name === name)!, 0, ['10.0.0.5'], 'lw.internal', {
        images: { [name]: `${d.compose.services.find((s) => s.name === name)!.image}@${DIGEST}` },
        secretVersions: {},
      }).specHash;

    // Computed with the pre-M7 `buildWorkloadSpec` (HEAD before W2 / W3).
    expect(hash('web')).toBe('3a0b3f07e2e1541f1b7ca920c6a430b9');
    expect(hash('sandbox')).toBe('b35967a41a30d345878365f17b918d85');
  });

  it('emits isolation, devices and microvm only for the levels that need them', () => {
    const { parsed, issues } = parse(LADDER);

    expect(issues.filter((i) => i.level === 'error')).toEqual([]);

    const d = parsed[0];
    const spec = (name: string) =>
      buildWorkloadSpec(d, d.compose.services.find((s) => s.name === name)!, 0, ['10.0.0.5'], 'lw', {
        images: { [name]: `alpine:3@${DIGEST}` },
        secretVersions: {},
      });

    for (const name of ['plain', 'gvisor', 'gvisorkvm', 'vm', 'kvm'])
      expect(workloadSpecSchema.safeParse(spec(name)).success).toBe(true);

    expect(spec('plain')).not.toHaveProperty('isolation');
    expect(spec('plain')).not.toHaveProperty('devices');
    expect(spec('gvisor')).toMatchObject({ runtime: 'sandboxed' });
    expect(spec('gvisor')).not.toHaveProperty('isolation');
    expect(spec('gvisorkvm')).toMatchObject({ runtime: 'sandboxed', isolation: 'sandboxed-kvm' });
    expect(spec('gvisorkvm')).not.toHaveProperty('microvm');
    expect(spec('vm')).toMatchObject({ runtime: 'runc', isolation: 'microvm', microvm: { vcpus: 2, memoryMiB: 1024 } });
    expect(spec('kvm')).toMatchObject({ runtime: 'runc', devices: [{ path: '/dev/kvm', permissions: 'rwm' }] });
    expect(spec('kvm')).not.toHaveProperty('isolation');
  });

  it('refuses /dev/kvm in projects without the admin allowance', () => {
    const { parsed, issues } = parse(LADDER, projectSpecSchema.parse({}));

    expect(parsed).toHaveLength(1);
    expect(issues).toContainEqual(
      expect.objectContaining({
        level: 'error',
        path: 'services.kvm.devices',
        message: expect.stringContaining('device /dev/kvm is not allowed in project shop'),
      }),
    );
  });

  it('reserves the deployment name lw-vm for virtual machines', () => {
    const { parsed, issues } = translateDeployments(
      [{ project: 'shop', name: 'lw-vm', spec: { compose: COMPOSE } }],
      new Map([['shop', allowKvm]]),
    );

    expect(parsed).toEqual([]);
    expect(issues).toContainEqual(
      expect.objectContaining({ level: 'error', message: expect.stringContaining('reserved') }),
    );
  });

  it('translates levels, /dev/kvm and microVM requests (with the launcher overhead) for the scheduler', () => {
    const services = new Map(toSchedulerServices(parse(LADDER).parsed).map((s) => [s.id.split('/')[2], s]));

    expect(services.get('plain')).toMatchObject({ runtime: 'runc' });
    expect(services.get('plain')).not.toHaveProperty('needsKvmDevice');
    expect(services.get('gvisorkvm')).toMatchObject({ runtime: 'sandboxed-kvm' });
    expect(services.get('kvm')).toMatchObject({ runtime: 'runc', needsKvmDevice: true });
    // Guest memory (limit 1 GiB) + 384 MiB; CPU request + 250 m.
    expect(services.get('vm')?.requests).toEqual({
      cpuMillis: 500 + MICROVM_LAUNCHER_OVERHEAD.cpuMillis,
      memoryBytes: 1024 * MiB + 384 * MiB,
    });
    // Refuse-gated features are hard rules of the scheduler, not soft `requiredFeatures`.
    for (const s of services.values()) expect(s.requiredFeatures).toBeUndefined();
    expect(replicaAgentFeatures(services.get('vm')!)).toEqual(['isolation-ladder', 'microvm']);
    expect(replicaAgentFeatures(services.get('kvm')!)).toEqual(['workload-devices']);
  });

  it('carries every level, KVM facts, probe states and derived runtime labels to the scheduler', () => {
    const [n] = toSchedulerNodes([
      node('n1', {
        labels: { 'loadweaver.com/runtime': 'spoofed', tier: 'a' },
        runtimes: ['runc', 'sandboxed', 'sandboxed-kvm', 'microvm', 'firecracker'],
        isolation: {
          microvm: { state: 'ready' },
          'sandboxed-kvm': { state: 'probe-failed', reasonCode: 'E_PROBE_TIMEOUT' },
          firecracker: { state: 'ready' },
        },
        kvm,
        virtualMachines: true,
      }),
    ]);

    expect(n.runtimes).toEqual(['runc', 'sandboxed', 'sandboxed-kvm', 'microvm']);
    expect(n.kvm).toEqual(kvm);
    expect(n.virtualMachines).toBe(true);
    expect(n.isolation).toEqual({
      microvm: { state: 'ready' },
      'sandboxed-kvm': { state: 'probe-failed', reasonCode: 'E_PROBE_TIMEOUT' },
    });
    expect(n.labels).toMatchObject({
      tier: 'a',
      'loadweaver.com/runtime': 'microvm',
      'runtime.loadweaver.com/sandboxed-kvm': 'ready',
      'runtime.loadweaver.com/runc': 'ready',
    });
  });

  describe('places every level on nodes with exactly that level', () => {
    const nodes: SchedulerNode[] = toSchedulerNodes([
      node('plain', { runtimes: ['runc'] }),
      node('gvisor', { runtimes: ['runc', 'sandboxed'] }),
      node('gkvm', { runtimes: ['runc', 'sandboxed', 'sandboxed-kvm'], kvm }),
      node('micro', { runtimes: ['runc', 'microvm'], kvm, features: ['isolation-ladder', 'microvm'] }),
      node('kvmhost', { runtimes: ['runc'], kvm, features: ['workload-devices'] }),
    ]);
    const services = toSchedulerServices(parse(LADDER).parsed);
    const result = schedule({ nodes, services });
    const placed = (name: string) =>
      result.replicas.filter((r) => r.service === `shop/store/${name}`).map((r) => r.node);

    it.each([
      ['gvisor', ['gvisor', 'gkvm']],
      ['gvisorkvm', ['gkvm']],
      ['vm', ['micro']],
      ['kvm', ['gkvm', 'kvmhost']],
    ])('%s', (service, allowed) => {
      expect(result.unschedulable).toEqual([]);
      expect(placed(service)).toHaveLength(1);
      expect(allowed).toContain(placed(service)[0]);
    });

    it('never places a KVM level on an opted-out node or an agent without the refuse-gated features', () => {
      const refused = toSchedulerNodes([
        node('optout', { runtimes: ['runc', 'sandboxed-kvm', 'microvm'], kvm: { usable: true, optOut: true } }),
        node('old', { runtimes: ['runc', 'microvm'], kvm, features: ['live-migration'] }),
      ]);
      const r = schedule({
        nodes: refused,
        services: services.filter((s) => s.id.endsWith('/vm') || s.id.endsWith('/gvisorkvm')),
      });

      expect(r.replicas).toEqual([]);
      expect(r.unschedulable.map((u) => u.service).sort()).toEqual(['shop/store/gvisorkvm', 'shop/store/vm']);
    });
  });
});
