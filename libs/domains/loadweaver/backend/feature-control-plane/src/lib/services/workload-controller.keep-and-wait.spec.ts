import { clusterSpecSchema, projectSpecSchema } from '@forepath/loadweaver/shared/util-model';

import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { NodeEntity } from '../entities/node.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import type { WaitingWorkload } from '../utils/untouched-workloads.utils';
import { drainBlockers, WorkloadControllerService } from './workload-controller.service';
import { WorkloadPlannerService, type WorkloadPlan } from './workload-planner.service';

/**
 * Controllers keep and wait (user decision 2026-11-01): failover keeps replicas that fit nowhere on their lost node
 * (placed by a later pass once a node can run them); a drain is refused only for what is on the draining nodes.
 */
const GiB = 1024 ** 3;
// The planner judges reachability by the wall clock.
const NOW = Date.now();

const resources = [
  Object.assign(new ResourceEntity(), {
    kind: 'Cluster',
    name: 'cluster',
    project: null,
    spec: clusterSpecSchema.parse({ network: { podPoolV4: '10.244.0.0/16', servicePoolV4: '10.96.0.0/16' } }),
  }),
  Object.assign(new ResourceEntity(), {
    kind: 'Project',
    name: 'shop',
    project: null,
    spec: projectSpecSchema.parse({}),
  }),
  Object.assign(new ResourceEntity(), {
    kind: 'Deployment',
    name: 'web',
    project: 'shop',
    // `b` runs sandboxed: only nodes offering gVisor take it.
    spec: {
      compose:
        'services:\n  a: { image: nginx:1.27 }\n  b: { image: nginx:1.27, x-loadweaver: { runtime: sandboxed } }\n',
    },
  }),
];

const node = (name: string, extra: Partial<NodeEntity> = {}) =>
  Object.assign(new NodeEntity(), {
    name,
    site: 's',
    labels: {},
    lifecycle: 'active',
    witness: false,
    controlPlane: false,
    capacity: { cpuMillis: 8000, memoryBytes: 32 * GiB, diskBytes: 500 * GiB },
    capabilities: { runtimes: ['runc'] },
    protocolFeatures: [],
    joinedAt: new Date(NOW - 3_600_000),
    lastSeenAt: new Date(NOW),
    ...extra,
  });
const sandboxed = { capabilities: { runtimes: ['runc', 'sandboxed'] } };

const placement = (id: string, nodeName: string) => {
  const [project, deployment, service] = id.split('/');

  return Object.assign(new WorkloadPlacementEntity(), {
    id,
    project,
    deployment,
    service,
    node: nodeName,
    addresses: [],
    status: null,
    drainUntil: null,
    targetNode: null,
    cronRun: null,
    migration: null,
  });
};

function controller(nodes: NodeEntity[], placements: WorkloadPlacementEntity[]) {
  const rows = new Map<unknown, unknown[]>([
    [NodeEntity, nodes],
    [WorkloadPlacementEntity, placements],
    [ResourceEntity, resources],
    [VolumePlacementEntity, []],
    [NodeDesiredStateEntity, []],
    [DeploymentStateEntity, []],
  ]);
  const manager = {
    query: async () => [],
    getRepository: (entity: unknown) => ({ find: async () => rows.get(entity) ?? [], save: async (x: unknown) => x }),
  };
  const planner = new WorkloadPlannerService();
  const persisted: WorkloadPlan[] = [];

  jest.spyOn(planner, 'persist').mockImplementation(async (_m, plan) => {
    persisted.push(plan);
  });

  const service = Object.create(WorkloadControllerService.prototype) as WorkloadControllerService;
  const warn = jest.fn();

  Object.assign(service, { planner, audit: { record: jest.fn() }, logger: { warn, log: jest.fn() } });

  const run = (step: 'failover' | 'evacuate') =>
    (service as unknown as Record<string, (m: unknown, now: number) => Promise<boolean>>)[step](manager, NOW);

  return { run, persisted, warn };
}

const placed = (plan: WorkloadPlan) => plan.schedule.replicas.map((r) => `${r.replica}@${r.node}`).sort();

describe('controllers keep and wait (user decision 2026-11-01)', () => {
  describe('failover', () => {
    const lost = node('n1', { ...sandboxed, lastSeenAt: new Date(NOW - 120_000) });

    it('moves what fits, keeps what fits nowhere on its lost node, and places it once a node can run it', async () => {
      // Pass 1: `a` moves to n2, `b` (sandboxed, only n1 offers it) waits on n1.
      const first = controller([lost, node('n2')], [placement('shop/web/a/0', 'n1'), placement('shop/web/b/0', 'n1')]);

      expect(await first.run('failover')).toBe(true);
      expect(placed(first.persisted[0])).toEqual(['shop/web/a/0@n2', 'shop/web/b/0@n1']);
      expect(first.warn).toHaveBeenCalledWith(expect.stringContaining('shop/web/b/0 (no eligible node'));

      // Pass 2: only the waiting replica is left on the lost node: nothing to persist.
      const second = controller([lost, node('n2')], [placement('shop/web/a/0', 'n2'), placement('shop/web/b/0', 'n1')]);

      expect(await second.run('failover')).toBe(false);
      expect(second.persisted).toEqual([]);

      // Capacity returns (a node offering gVisor joined): the next pass places it, no plan needed.
      const third = controller(
        [lost, node('n2'), node('n3', sandboxed)],
        [placement('shop/web/a/0', 'n2'), placement('shop/web/b/0', 'n1')],
      );

      expect(await third.run('failover')).toBe(true);
      expect(placed(third.persisted[0])).toEqual(['shop/web/a/0@n2', 'shop/web/b/0@n3']);
    });
  });

  describe('drain', () => {
    it('drains next to an unplaceable workload elsewhere; that one keeps its placement', async () => {
      const { run, persisted, warn } = controller(
        [node('n1', { lifecycle: 'draining' }), node('n2'), node('n3', { ...sandboxed, lastSeenAt: new Date(0) })],
        [placement('shop/web/a/0', 'n1'), placement('shop/web/b/0', 'n3')],
      );

      expect(await run('evacuate')).toBe(true);
      expect(placed(persisted[0])).toEqual(['shop/web/a/0@n2', 'shop/web/b/0@n3']);
      expect(warn).not.toHaveBeenCalled();
    });

    it('is refused while a replica on the draining node can not move anywhere (nothing moves)', async () => {
      const { run, persisted, warn } = controller(
        [node('n1', { ...sandboxed, lifecycle: 'draining' }), node('n2')],
        [placement('shop/web/a/0', 'n1'), placement('shop/web/b/0', 'n1')],
      );

      expect(await run('evacuate')).toBe(false);
      expect(persisted).toEqual([]);
      expect(warn).toHaveBeenCalledWith('Drain blocked: shop/web/b/0 cannot be placed elsewhere');
    });

    it('counts waiting services with volume copies on a draining node, not single-writer extras', () => {
      const parsed = new WorkloadPlannerService().parse([
        ...resources.slice(0, 2),
        Object.assign(new ResourceEntity(), {
          kind: 'Deployment',
          name: 'db',
          project: 'shop',
          spec: {
            compose:
              'services:\n  pg: { image: postgres:17, volumes: [data:/var/lib/postgresql] }\nvolumes:\n  data: {}\n',
          },
        }),
      ]).parsed;
      const volumes = [{ id: 'shop/db/data', primaryNode: 'n2', syncReplicas: ['n1'], remoteReplicas: [] }];
      const waiting = (extra: Partial<WaitingWorkload>): WaitingWorkload[] => [
        { service: 'shop/db/pg', reason: 'no eligible node', nodes: ['n2'], ...extra },
      ];

      expect(drainBlockers({ parsed, waiting: waiting({}) }, new Set(), volumes, new Set(['n1']))).toEqual([
        'shop/db/pg',
      ]);
      expect(
        drainBlockers(
          { parsed, waiting: waiting({ replica: 'shop/db/pg/1', cause: 'single-writer' }) },
          new Set(),
          volumes,
          new Set(['n1']),
        ),
      ).toEqual([]);
    });
  });
});
