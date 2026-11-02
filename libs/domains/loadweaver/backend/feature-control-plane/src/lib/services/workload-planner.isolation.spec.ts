import { volumeAssignmentSchema, workloadSpecSchema } from '@forepath/loadweaver/shared/util-agent-protocol';
import { projectSpecSchema } from '@forepath/loadweaver/shared/util-model';

import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import type { ImageInspection } from '../utils/microvm-planning.utils';
import { toSchedulerNodes, toSchedulerServices } from '../utils/workload-planning.utils';
import {
  desiredHost,
  effectiveSpec,
  nodeKvmSettings,
  nodeVolumes,
  withMigrationHints,
  workloadCompilerInput,
} from './network-state.service';
import {
  isolationCapabilities,
  isolationPlanNotes,
  kvmOptOutIssues,
  kvmOptOutNodes,
  migrationLauncher,
  pinVmsWithoutFailover,
  plannerNodes,
  podSubnetsOf,
  WorkloadPlannerService,
} from './workload-planner.service';

const GiB = 1024 ** 3;
const sha = (c: string) => `sha256:${c.repeat(64)}`;

const resource = (kind: string, name: string, spec: unknown, project: string | null = null, labels = {}) =>
  Object.assign(new ResourceEntity(), { kind, name, project, projectKey: project ?? '', labels, spec });

const COMPOSE = `
services:
  web: { image: nginx:1.27 }
  gkvm: { image: alpine:3, x-loadweaver: { runtime: sandboxed-kvm } }
`;

const VM = {
  image: 'registry.lw/shop/debian:13',
  cpu: { vcpus: 1 },
  memory: '1Gi',
  disks: [{ name: 'root', size: '10Gi', source: 'image' }],
  nics: [
    { name: 'eth0', groups: ['db'] },
    { name: 'mgmt', groups: ['admin'], labels: { zone: 'mgmt' } },
  ],
  ha: { restartElsewhere: false },
};

const resources = [
  resource('Project', 'shop', projectSpecSchema.parse({})),
  resource('Deployment', 'store', { compose: COMPOSE }, 'shop'),
  resource('VirtualMachine', 'db1', VM, 'shop', { app: 'db' }),
  resource('Node', 'n1', { site: 's', virtualization: { kvm: 'disabled' } }),
  resource('Node', 'n2', { site: 's' }),
];

const planner = new WorkloadPlannerService();
const { parsed, issues } = planner.parse(resources);

const nodeEntity = (name: string, capabilities: Record<string, unknown>) =>
  Object.assign(new NodeEntity(), {
    name,
    site: 's',
    labels: {},
    lifecycle: 'active',
    witness: false,
    controlPlane: false,
    capacity: { cpuMillis: 8000, memoryBytes: 32 * GiB, diskBytes: 500 * GiB },
    capabilities,
    protocolFeatures: [],
    lastSeenAt: new Date(),
  });

const vmImage: ImageInspection = {
  manifestDigest: sha('f'),
  platform: 'linux/amd64',
  platforms: [],
  labels: {},
  config: {},
  layers: [],
  vmImage: { arch: 'amd64', format: 'raw', layerDigest: sha('2'), virtualSize: GiB, firmware: ['uefi'] },
};

describe('workload planner: isolation levels and VMs (M7 W3)', () => {
  it('parses compose deployments and virtual machines together', () => {
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(parsed.map((d) => `${d.project}/${d.name}`).sort()).toEqual(['shop/lw-vm', 'shop/store']);
    expect(
      toSchedulerServices(parsed)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['shop/lw-vm/db1', 'shop/store/gkvm', 'shop/store/web']);
  });

  it('reads KVM facts, probe states and VM support from the capabilities, with the node spec opt-out', () => {
    const optOut = kvmOptOutNodes(resources);

    expect(optOut).toEqual(new Set(['n1']));
    expect(isolationCapabilities({ kvm: { usable: true, optOut: false }, virtualMachines: true }, false)).toEqual({
      kvm: { usable: true, optOut: false },
      virtualMachines: true,
    });
    expect(isolationCapabilities({ kvm: { usable: true, optOut: false } }, true)).toEqual({
      kvm: { usable: true, optOut: true },
    });
    expect(isolationCapabilities(null, true)).toEqual({ kvm: { usable: false, optOut: true } });
    expect(isolationCapabilities({ runtimes: ['runc'] })).toEqual({});

    const [n1, n2] = plannerNodes(
      [
        nodeEntity('n1', { runtimes: ['runc', 'sandboxed-kvm'], kvm: { usable: true, optOut: false } }),
        nodeEntity('n2', {
          runtimes: ['runc', 'sandboxed-kvm', 'microvm'],
          kvm: { usable: true, optOut: false },
          isolation: { microvm: { state: 'ready', checkedAt: '2026-10-23T00:00:00Z' } },
          virtualMachines: true,
        }),
      ],
      Date.now(),
      undefined,
      optOut,
    );

    expect(n1).toMatchObject({ kvm: { usable: true, optOut: true }, runtimes: ['runc', 'sandboxed-kvm'] });
    expect(n2).toMatchObject({ kvm: { usable: true, optOut: false }, virtualMachines: true });
    expect(toSchedulerNodes([n2])[0].isolation).toEqual({ microvm: { state: 'ready' } });
  });

  it('refuses to opt out a node that still runs KVM workloads', () => {
    const services = toSchedulerServices(parsed);
    const nodes = [nodeEntity('n1', { kvm: { usable: true, optOut: false } })];
    const current = [
      { service: 'shop/store/gkvm', replica: 'shop/store/gkvm/0', node: 'n1' },
      { service: 'shop/store/web', replica: 'shop/store/web/0', node: 'n1' },
    ];

    expect(kvmOptOutIssues(new Set(['n1']), current, services, nodes)).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'node n1 still runs KVM workloads (shop/store/gkvm/0); drain it first, then disable KVM',
      }),
    ]);
    // Only runc replicas, or the agent already applied the opt-out: fine.
    expect(kvmOptOutIssues(new Set(['n1']), current.slice(1), services, nodes)).toEqual([]);
    expect(
      kvmOptOutIssues(new Set(['n1']), current, services, [nodeEntity('n1', { kvm: { usable: true, optOut: true } })]),
    ).toEqual([]);
  });

  it('notes the exact level of every isolated service with the nodes offering it and those refused', () => {
    const nodes = toSchedulerNodes([
      ...plannerNodes([
        nodeEntity('a', { runtimes: ['runc', 'sandboxed', 'sandboxed-kvm'], kvm: { usable: true, optOut: false } }),
        nodeEntity('b', { runtimes: ['runc', 'sandboxed', 'sandboxed-kvm'], kvm: { usable: true, optOut: false } }),
      ]).map((n) => ({ ...n, features: n.name === 'b' ? ['live-migration'] : ['isolation-ladder'] })),
    ]);
    const notes = isolationPlanNotes(toSchedulerServices(parsed), nodes);

    expect(notes.map((n) => n.message).sort()).toEqual([
      'db1 runs at exactly virtual machine; nodes offering it: none',
      'gkvm runs at exactly runtime sandboxed-kvm; nodes offering it: a, b (refused: b lack the agent features isolation-ladder)',
    ]);
  });

  it('tells the migration eligibility what a launcher workload is (M7.4, W10b)', () => {
    const vmDeployment = parsed.find((d) => d.name === 'lw-vm');
    const db1 = vmDeployment?.compose.services.find((x) => x.name === 'db1');

    expect(db1 && vmDeployment && migrationLauncher(vmDeployment, db1, undefined)).toEqual({
      kind: 'vm',
      cpuModel: 'host-model',
    });
    expect(migrationLauncher({}, { name: 'web', runtime: 'runc' }, undefined)).toBeUndefined();
    expect(migrationLauncher({}, { name: 'web', runtime: 'sandboxed-kvm' }, undefined)).toBeUndefined();
    expect(migrationLauncher({}, { name: 'm', runtime: 'microvm' }, undefined)).toEqual({ kind: 'unknown' });
    expect(
      migrationLauncher({}, { name: 'm', runtime: 'microvm' }, {
        labels: { 'io.agenstra.microvm.protocol': '1' },
      } as unknown as ImageInspection),
    ).toEqual({ kind: 'bundled', migration: false });
    // M7 W10b: the label inherited from the launcher base (generic, vm) doesn't make a bundled image migratable.
    expect(
      migrationLauncher({}, { name: 'm', runtime: 'microvm' }, {
        labels: { 'io.agenstra.microvm.protocol': '1', 'io.forepath.microvm.migration': 'generic,vm' },
      } as unknown as ImageInspection),
    ).toEqual({ kind: 'bundled', migration: false });
    expect(
      migrationLauncher({}, { name: 'm', runtime: 'microvm' }, {
        labels: { 'io.agenstra.microvm.protocol': '1', 'io.forepath.microvm.migration': 'generic, bundled' },
      } as unknown as ImageInspection),
    ).toEqual({ kind: 'bundled', migration: true });
    expect(
      migrationLauncher({}, { name: 'm', runtime: 'microvm' }, { labels: {} } as unknown as ImageInspection),
    ).toEqual({ kind: 'generic' });
  });

  it('pins VMs without failover to their current node', () => {
    const services = pinVmsWithoutFailover(toSchedulerServices(parsed), parsed, [
      { service: 'shop/lw-vm/db1', replica: 'shop/lw-vm/db1/0', node: 'n2' },
    ]);

    expect(services.find((s) => s.id === 'shop/lw-vm/db1')?.selector).toEqual({
      matchLabels: { 'loadweaver.com/node': 'n2' },
    });
    expect(services.find((s) => s.id === 'shop/store/web')?.selector).toBeUndefined();
  });
});

describe('desired host settings (3.1)', () => {
  it('sends the node spec KVM setting and the probe nonce only when set', () => {
    const settings = nodeKvmSettings(resources);

    expect(settings).toEqual(new Map([['n1', 'disabled']]));
    expect(desiredHost(settings.get('n1'), null)).toEqual({ kvm: 'disabled' });
    expect(desiredHost(undefined, 'abc-1')).toEqual({ probeNonce: 'abc-1' });
    expect(desiredHost('auto', 'abc-1')).toEqual({ kvm: 'auto', probeNonce: 'abc-1' });
    expect(desiredHost(settings.get('n2'), null)).toBeUndefined();
  });
});

describe('network compile of VMs (M7.3, one policy member per NIC)', () => {
  const placement = {
    id: 'shop/lw-vm/db1/0',
    node: 'n2',
    addresses: ['10.88.1.5', 'fd00:88:1::5', '10.88.1.6', 'fd00:88:1::6'],
  };
  const subnets = podSubnetsOf([{ name: 'n2', podSubnetV4: '10.88.1.0/24', podSubnetV6: 'fd00:88:1::/80' }]);
  const states = [
    {
      id: 'shop/lw-vm',
      images: { db1: `registry.lw/shop/debian:13@${sha('9')}` },
      secretVersions: {},
      generation: 1,
      imageConfigs: { db1: vmImage },
    },
  ];

  it('splits a VM into one compiler workload per NIC with its own groups and labels', () => {
    const input = workloadCompilerInput({ parsed, placements: [placement], services: [], podSubnets: subnets });
    const vm = input.workloads.filter((w) => w.service === 'db1');

    expect(vm).toEqual([
      expect.objectContaining({
        id: 'shop/lw-vm/db1/0',
        addresses: ['10.88.1.5', 'fd00:88:1::5'],
        groups: ['db'],
        labels: expect.objectContaining({ app: 'db', 'loadweaver.com/vm': 'db1', 'loadweaver.com/nic': 'eth0' }),
      }),
      expect.objectContaining({
        id: 'shop/lw-vm/db1/0#mgmt',
        addresses: ['10.88.1.6', 'fd00:88:1::6'],
        groups: ['admin'],
        secondaryInterface: true,
        labels: expect.objectContaining({ zone: 'mgmt', 'loadweaver.com/nic': 'mgmt' }),
      }),
    ]);
    expect(vm[0].secondaryInterface).toBeUndefined();
  });

  it('runs a VM only once its image is pinned, and keeps per-NIC addresses after a live migration', () => {
    const context = { parsed, placements: [placement], services: [], podSubnets: subnets };

    expect(effectiveSpec(placement, placement.addresses, context, 'lw')).toBeNull();

    const spec = effectiveSpec(placement, placement.addresses, { ...context, states }, 'lw');

    expect(spec && workloadSpecSchema.safeParse(spec).success).toBe(true);

    // Moved to n3 keeping its addresses: host routes for the first NIC (workload) and the extra one (vm.nics).
    const moved = withMigrationHints(
      spec!,
      { ...placement, node: 'n3' },
      'n3',
      podSubnetsOf([
        { name: 'n2', podSubnetV4: '10.88.1.0/24', podSubnetV6: 'fd00:88:1::/80' },
        { name: 'n3', podSubnetV4: '10.88.2.0/24', podSubnetV6: null },
      ]),
    );

    expect(moved.hostRoutes).toEqual(['10.88.1.5/32', 'fd00:88:1::5/128']);
    expect(moved.vm?.nics[0].hostRoutes).toBeUndefined();
    expect(moved.vm?.nics[1].hostRoutes).toEqual(['10.88.1.6/32', 'fd00:88:1::6/128']);
    expect(workloadSpecSchema.safeParse(moved).success).toBe(true);
  });

  it('assigns VM disks in block mode with the boot disk initialized from the image', () => {
    const volume = Object.assign(new VolumePlacementEntity(), {
      id: 'shop/lw-vm/db1.root',
      primaryNode: 'n2',
      syncReplicas: [],
      remoteReplicas: [],
      sizeBytes: String(10 * GiB),
      crossSite: 'async' as const,
      drbdMinor: 1000,
      drbdPort: 7800,
    });
    const nodes = [Object.assign(new NodeEntity(), { name: 'n2', site: 's', overlayV4: '10.93.0.2', overlayV6: null })];
    const [plain] = nodeVolumes('n2', [volume], nodes);
    const [block] = nodeVolumes(
      'n2',
      [volume],
      nodes,
      new Map([
        [
          'shop/lw-vm/db1.root',
          { mode: 'block' as const, initializeFrom: { digest: sha('2'), format: 'raw' as const } },
        ],
      ]),
    );

    expect(plain).not.toHaveProperty('mode');
    expect(block).toMatchObject({ mode: 'block', initializeFrom: { digest: sha('2'), format: 'raw' } });
    expect(volumeAssignmentSchema.safeParse(block).success).toBe(true);
  });
});
