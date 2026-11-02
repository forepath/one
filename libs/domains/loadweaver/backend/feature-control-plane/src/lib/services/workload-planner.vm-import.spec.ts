import { projectSpecSchema } from '@forepath/loadweaver/shared/util-model';

import { NodeEntity } from '../entities/node.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { drainEvacuation } from './workload-controller.service';
import { WorkloadPlannerService } from './workload-planner.service';

/**
 * No planned move during a VM's first boot-disk import (M7 F4): the planner keeps an importing VM (and its disk
 * volumes) on its node with a plan note, drains wait for it; node loss / failover isn't held.
 */
const GiB = 1024 ** 3;
const REPLICA = 'shop/lw-vm/db1/0';
const DISK = 'shop/lw-vm/db1.root';

const vm = (selector?: Record<string, string>) =>
  Object.assign(new ResourceEntity(), {
    kind: 'VirtualMachine',
    name: 'db1',
    project: 'shop',
    labels: {},
    spec: {
      image: 'registry.lw/shop/debian:13',
      cpu: { vcpus: 1 },
      memory: '1Gi',
      disks: [{ name: 'root', size: '10Gi', source: 'image' }],
      nics: [{ name: 'eth0' }],
      ...(selector ? { placement: { selector: { matchLabels: selector } } } : {}),
    },
  });

const resources = (selector?: Record<string, string>) => [
  Object.assign(new ResourceEntity(), {
    kind: 'Project',
    name: 'shop',
    project: null,
    spec: projectSpecSchema.parse({}),
  }),
  vm(selector),
];

const node = (name: string, extra: Partial<NodeEntity> = {}) =>
  Object.assign(new NodeEntity(), {
    name,
    site: 's',
    labels: { zone: name === 'n1' ? 'a' : 'b' },
    lifecycle: 'active',
    witness: false,
    controlPlane: false,
    capacity: { cpuMillis: 8000, memoryBytes: 32 * GiB, diskBytes: 500 * GiB },
    capabilities: { runtimes: ['runc', 'microvm'], kvm: { usable: true, optOut: false }, virtualMachines: true },
    protocolFeatures: ['isolation-ladder', 'virtual-machines', 'vm-block-volumes'],
    lastSeenAt: new Date(),
    ...extra,
  });

const placement = (phase?: string) => ({
  id: REPLICA,
  project: 'shop',
  deployment: 'lw-vm',
  service: 'db1',
  node: 'n1',
  cronRun: null,
  drainUntil: null,
  migration: null,
  status: {
    n1: {
      state: 'pending',
      specHash: 'h',
      at: new Date().toISOString(),
      ...(phase
        ? { vm: { importing: true, importProgress: { phase, bytes: 512 * 1024 ** 2, totalBytes: 2 * GiB } } }
        : {}),
    },
  },
});

function manager(placements: unknown[]) {
  const rows = new Map<unknown, unknown[]>([
    [WorkloadPlacementEntity, placements],
    [VolumePlacementEntity, [{ id: DISK, primaryNode: 'n1', syncReplicas: ['n2'], remoteReplicas: [] }]],
    [NodeDesiredStateEntity, []],
  ]);

  return {
    query: async () => [],
    getRepository: (entity: unknown) => ({ find: async () => rows.get(entity) ?? [] }),
  } as never;
}

const vmNode = (plan: Awaited<ReturnType<WorkloadPlannerService['plan']>>) =>
  plan.schedule.replicas.find((r) => r.replica === REPLICA)?.node;
const diskPrimary = (plan: Awaited<ReturnType<WorkloadPlannerService['plan']>>) =>
  plan.schedule.volumes.find((v) => v.volume === DISK)?.primary;

describe('planned moves held during the first boot-disk import (M7 F4)', () => {
  const planner = new WorkloadPlannerService();

  it('moves a VM whose boot disk is written (selector change) only once the import finished', async () => {
    const moved = await planner.plan(manager([placement()]), resources({ zone: 'b' }), [node('n1'), node('n2')]);

    expect(moved.schedule.unschedulable).toEqual([]);
    expect(vmNode(moved)).toBe('n2');
    expect(diskPrimary(moved)).toBe('n2');

    for (const phase of ['queued', 'fetching', 'writing']) {
      const held = await planner.plan(manager([placement(phase)]), resources({ zone: 'b' }), [node('n1'), node('n2')]);

      expect(vmNode(held)).toBe('n1');
      expect(diskPrimary(held)).toBe('n1');
      expect(held.changes.filter((c) => c.action === 'move')).toEqual([]);
      expect(held.issues).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          project: 'shop',
          deployment: 'lw-vm',
          path: 'db1.placement',
          message: expect.stringMatching(
            new RegExp(
              `db1 stays on n1 while waiting for the boot-disk import \\(${phase}, 512 MiB of 2048 MiB\\); it moves to n2`,
            ),
          ),
        }),
      );
    }
  });

  it('does not hold a failed import', async () => {
    const plan = await planner.plan(manager([placement('failed')]), resources({ zone: 'b' }), [node('n1'), node('n2')]);

    expect(vmNode(plan)).toBe('n2');
  });

  it('keeps an importing VM on a draining node instead of reporting it unschedulable', async () => {
    const draining = [node('n1', { lifecycle: 'draining' })];
    const blocked = await planner.plan(manager([placement()]), resources(), draining);

    expect(blocked.schedule.unschedulable.map((u) => u.service)).toEqual(['shop/lw-vm/db1']);

    const held = await planner.plan(manager([placement('writing')]), resources(), draining);

    expect(held.schedule.unschedulable).toEqual([]);
    expect(vmNode(held)).toBe('n1');
    expect(held.issues).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('plan again once the import finished') }),
    );
  });

  it('leaves failover alone: a VM on an unreachable node moves even mid-import (accepted risk)', async () => {
    const lost = node('n1', { lastSeenAt: new Date(Date.now() - 5 * 60_000) });
    const plan = await planner.plan(manager([placement('writing')]), resources(), [lost, node('n2')]);

    expect(vmNode(plan)).toBe('n2');
    expect(plan.issues.filter((i) => i.message.includes('boot-disk import'))).toEqual([]);
  });
});

describe('drain evacuation with importing VMs (M7 F4)', () => {
  const hold = {
    replica: REPLICA,
    service: 'shop/lw-vm/db1',
    project: 'shop',
    vm: 'db1',
    node: 'n1',
    phase: 'writing',
    bytes: 512 * 1024 ** 2,
    totalBytes: 2 * GiB,
  };
  const placements = [
    { id: REPLICA, node: 'n1', migration: null, drainUntil: null },
    { id: 'shop/store/web/0', node: 'n1', migration: null, drainUntil: null },
  ];
  const volumes = [
    { id: DISK, pendingPrimary: null, syncReplicas: ['n1'], remoteReplicas: [] },
    { id: 'shop/store/data', pendingPrimary: null, syncReplicas: [], remoteReplicas: [] },
  ];

  it('moves the rest, reports the VM as waiting with its import progress', () => {
    const result = drainEvacuation(placements, volumes, new Set(['n1']), new Map([[REPLICA, hold]]));

    expect([...result.moving]).toEqual(['shop/store/web/0']);
    // The held VM's disk copy stays too: nothing else to move.
    expect(result.volumesOnNode).toBe(false);
    expect(result.waiting).toEqual([
      'virtual machine shop/db1 is waiting for the boot-disk import on n1 (writing, 512 MiB of 2048 MiB)',
    ]);
  });

  it('moves the VM and its disk copies once nothing holds them', () => {
    const result = drainEvacuation(placements, volumes, new Set(['n1']), new Map());

    expect([...result.moving].sort()).toEqual([REPLICA, 'shop/store/web/0']);
    expect(result.volumesOnNode).toBe(true);
    expect(result.waiting).toEqual([]);
  });
});
