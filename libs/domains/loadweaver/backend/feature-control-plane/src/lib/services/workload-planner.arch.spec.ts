import { projectSpecSchema } from '@forepath/loadweaver/shared/util-model';

import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { NodeEntity } from '../entities/node.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import type { ImageInspection } from '../utils/microvm-planning.utils';
import { WorkloadPlannerService } from './workload-planner.service';

/**
 * Mixed-arch clusters (M7 follow-up F1): a generic microVM's pinned guest image decides which node architectures can
 * run it; the planner reads the stored inspections, replaced by a plan's not yet persisted ones.
 */
const GiB = 1024 ** 3;
const sha = (c: string) => `sha256:${c.repeat(64)}`;
const COMPOSE = `
services:
  app: { image: registry.lw/shop/app:1, x-loadweaver: { runtime: microvm } }
  web: { image: nginx:1.27 }
`;

const resources = [
  Object.assign(new ResourceEntity(), {
    kind: 'Project',
    name: 'shop',
    project: null,
    spec: projectSpecSchema.parse({}),
  }),
  Object.assign(new ResourceEntity(), {
    kind: 'Deployment',
    name: 'store',
    project: 'shop',
    spec: { compose: COMPOSE },
  }),
];

const node = (name: string, arch: string) =>
  Object.assign(new NodeEntity(), {
    name,
    site: 's',
    labels: {},
    lifecycle: 'active',
    witness: false,
    controlPlane: false,
    os: { id: 'ubuntu', versionId: '24.04', kernel: '6.8', arch },
    capacity: { cpuMillis: 8000, memoryBytes: 32 * GiB, diskBytes: 500 * GiB },
    capabilities: { runtimes: ['runc', 'microvm'], kvm: { usable: true, optOut: false } },
    protocolFeatures: ['isolation-ladder', 'microvm'],
    lastSeenAt: new Date(),
  });

const layer = (c: string) => ({
  digest: sha(c),
  diffId: sha(c),
  size: 1,
  mediaType: 'application/vnd.oci.image.layer.v1.tar',
});
const inspection = (platform: string, platformLayers?: ImageInspection['platformLayers']): ImageInspection => ({
  manifestDigest: sha('a'),
  platform,
  platforms: [],
  labels: {},
  config: { cmd: ['serve'] },
  layers: [layer('1')],
  ...(platformLayers ? { platformLayers } : {}),
});

function manager(stored: Record<string, ImageInspection> | null, placedOn?: string) {
  const rows = new Map<unknown, unknown[]>([
    [
      WorkloadPlacementEntity,
      placedOn
        ? [{ id: 'shop/store/app/0', project: 'shop', deployment: 'store', service: 'app', node: placedOn }]
        : [],
    ],
    [VolumePlacementEntity, []],
    [NodeDesiredStateEntity, []],
    [DeploymentStateEntity, stored ? [{ id: 'shop/store', imageConfigs: stored }] : []],
  ]);

  return {
    query: async () => [],
    getRepository: (entity: unknown) => ({ find: async () => rows.get(entity) ?? [] }),
  } as never;
}

const appNode = (plan: Awaited<ReturnType<WorkloadPlannerService['plan']>>) =>
  plan.schedule.replicas.find((r) => r.service === 'shop/store/app')?.node;

describe('image architectures in the planner (3.35, mixed-arch clusters)', () => {
  const planner = new WorkloadPlannerService();
  const nodes = [node('amd', 'amd64'), node('arm', 'aarch64')];

  it('moves a microVM off nodes its stored guest image has no variant for', async () => {
    const plan = await planner.plan(manager({ app: inspection('linux/arm64') }, 'amd'), resources, nodes);

    expect(plan.schedule.unschedulable).toEqual([]);
    expect(appNode(plan)).toBe('arm');
  });

  it("uses the plan's pinned (not yet stored) inspections over the stored ones", async () => {
    const multi = inspection('linux/amd64', { amd64: [layer('1')], arm64: [layer('2')] });
    const kept = await planner.plan(manager({ app: inspection('linux/arm64') }, 'amd'), resources, nodes, {
      'shop/store': { imageConfigs: { app: multi } },
    });

    expect(appNode(kept)).toBe('amd');

    const none = await planner.plan(manager(null), resources, [node('arm', 'arm64')], {
      'shop/store': { imageConfigs: { app: inspection('linux/amd64', { amd64: [layer('1')] }) } },
    });

    expect(none.schedule.unschedulable).toEqual([
      {
        service: 'shop/store/app',
        reason: 'no eligible node (image architectures amd64: 0 of 1 node match — arm arm64)',
      },
    ]);
  });

  it('leaves services other than microVMs / VMs unrestricted', async () => {
    const plan = await planner.plan(manager({ app: inspection('linux/arm64') }), resources, [node('amd', 'amd64')]);

    expect(plan.schedule.replicas.find((r) => r.service === 'shop/store/web')?.node).toBe('amd');
    expect(plan.schedule.unschedulable.map((u) => u.service)).toEqual(['shop/store/app']);
  });
});
