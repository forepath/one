import { BadRequestException, ConflictException } from '@nestjs/common';
import { projectSpecSchema } from '@forepath/loadweaver/shared/util-model';

import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { NodeEntity } from '../entities/node.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import type { PlanEntity, PlanResourceChange } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import type { ImageInspection } from '../utils/microvm-planning.utils';
import { NOTHING_TOUCHED, touchedWorkloads, type TouchedWorkloads } from '../utils/untouched-workloads.utils';
import { PlansService } from './plans.service';
import { WorkloadPlannerService, type WorkloadPlan } from './workload-planner.service';

/**
 * Only touched workloads block a plan (user decision 2026-11-01): an existing deployment that can't be placed (no
 * workload node, its node offline) waits where it is; plans that add or change workloads that don't fit still fail.
 */
const GiB = 1024 ** 3;
const sha = (c: string) => `sha256:${c.repeat(64)}`;

const resource = (kind: string, name: string, project: string | null, spec: Record<string, unknown>) =>
  Object.assign(new ResourceEntity(), { kind, name, project, spec });
const project = (name: string) => resource('Project', name, null, projectSpecSchema.parse({}));
const nginx = resource('Deployment', 'test-nginx', 'test', { compose: 'services:\n  web: { image: nginx:1.27 }\n' });
const store = resource('Deployment', 'store', 'shop', {
  compose: 'services:\n  app: { image: registry.lw/shop/app:1, x-loadweaver: { runtime: microvm } }\n',
});

const node = (name: string, extra: Partial<NodeEntity> = {}) =>
  Object.assign(new NodeEntity(), {
    name,
    site: 's',
    labels: {},
    lifecycle: 'active',
    witness: false,
    controlPlane: false,
    os: { id: 'ubuntu', versionId: '24.04', kernel: '6.8', arch: 'x86_64' },
    capacity: { cpuMillis: 8000, memoryBytes: 32 * GiB, diskBytes: 500 * GiB },
    capabilities: { runtimes: ['runc'] },
    protocolFeatures: [],
    lastSeenAt: new Date(),
    ...extra,
  });
/** The built-in, in-process control-plane member: no workloads. */
const controlPlane = node('cp', { controlPlane: true, witness: true });
/** A stopped dev node. */
const offline = node('dev-1', { lastSeenAt: new Date(0) });
/** Runs microVMs only: test-nginx (runc) can't go there. */
const microvmNode = node('amd', {
  capabilities: { runtimes: ['microvm'], kvm: { usable: true, optOut: false } },
  protocolFeatures: ['isolation-ladder', 'microvm'],
});

function manager() {
  const rows = new Map<unknown, unknown[]>([
    [
      WorkloadPlacementEntity,
      [{ id: 'test/test-nginx/web/0', project: 'test', deployment: 'test-nginx', service: 'web', node: 'dev-1' }],
    ],
    [VolumePlacementEntity, []],
    [NodeDesiredStateEntity, []],
    // The apply re-plans against the stored nodes: the built-in member and the stopped dev node.
    [NodeEntity, [controlPlane, offline]],
    [DeploymentStateEntity, []],
  ]);

  return {
    query: async () => [],
    getRepository: (entity: unknown) => ({ find: async () => rows.get(entity) ?? [] }),
  } as never;
}

const change = (action: PlanResourceChange['action'], kind: string, name: string, proj: string | null) => ({
  action,
  kind,
  name,
  project: proj,
  baseGeneration: 0,
  before: null,
  after: null,
});
const projectOnly = [change('create', 'Project', 'zz-plan-probe', null)];
const nginxUpdate = [change('update', 'Deployment', 'test-nginx', 'test')];

interface Internals {
  placeWorkloads(
    manager: unknown,
    state: { after: ResourceEntity[]; nodesAfter: NodeEntity[] },
    toResolve: ReadonlySet<string>,
    confirmable: ReadonlySet<string>,
    touched: TouchedWorkloads,
    warnings: Record<string, unknown>[],
  ): Promise<{ workload: WorkloadPlan; deploymentStates: Record<string, unknown> }>;
  replanForApply(
    manager: unknown,
    entity: Pick<PlanEntity, 'changes' | 'deploymentStates' | 'workloadChanges'>,
    resources: ResourceEntity[],
  ): Promise<WorkloadPlan>;
  resolveDeployments: (...args: unknown[]) => Promise<Record<string, unknown>>;
}

function plans(): Internals {
  const service = Object.create(PlansService.prototype) as PlansService;

  Object.assign(service, { planner: new WorkloadPlannerService() });

  return service as unknown as Internals;
}

const issuesOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);

  expect(error).toBeInstanceOf(BadRequestException);

  return ((error as BadRequestException).getResponse() as { issues: Record<string, unknown>[] }).issues;
};

describe('only touched workloads block a plan (user decision 2026-11-01)', () => {
  const after = [project('test'), nginx, project('zz-plan-probe')];

  describe('WorkloadPlannerService.plan with `touched`', () => {
    const planner = new WorkloadPlannerService();

    it('keeps an untouched unplaceable workload where it is and notes it as waiting', async () => {
      const plan = await planner.plan(manager(), after, [controlPlane, offline], undefined, NOTHING_TOUCHED);

      expect(plan.schedule.unschedulable).toEqual([]);
      expect(plan.schedule.replicas).toEqual([
        { service: 'test/test-nginx/web', replica: 'test/test-nginx/web/0', node: 'dev-1' },
      ]);
      expect(plan.changes).toEqual([]);
      expect(plan.waiting).toEqual([expect.objectContaining({ service: 'test/test-nginx/web', nodes: ['dev-1'] })]);
      expect(plan.issues).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          project: 'test',
          deployment: 'test-nginx',
          path: 'test/test-nginx/web',
          message: expect.stringMatching(/^waiting for a node \(no eligible node .*it keeps its placement on dev-1$/),
        }),
      );
    });

    it('keeps the old behaviour without `touched` (DR recovery) and for touched workloads', async () => {
      const strict = await planner.plan(manager(), after, [controlPlane, offline]);
      const touched = await planner.plan(
        manager(),
        after,
        [controlPlane, offline],
        undefined,
        touchedWorkloads(nginxUpdate),
      );

      for (const plan of [strict, touched]) {
        expect(plan.schedule.unschedulable.map((u) => u.service)).toEqual(['test/test-nginx/web']);
        expect(plan.changes).toEqual([{ action: 'stop', replica: 'test/test-nginx/web/0', from: 'dev-1' }]);
      }
    });
  });

  describe('plan creation (preview)', () => {
    it('creates a project-only plan with 0 workload nodes; test-nginx waits (warning, placement kept)', async () => {
      const warnings: Record<string, unknown>[] = [];
      const { workload } = await plans().placeWorkloads(
        manager(),
        // Only the built-in member can be scheduled at all; the dev node is stopped.
        { after, nodesAfter: [controlPlane, offline] },
        new Set(),
        new Set(),
        touchedWorkloads(projectOnly),
        warnings,
      );

      expect(workload.schedule.replicas.map((r) => [r.replica, r.node])).toEqual([['test/test-nginx/web/0', 'dev-1']]);
      expect(workload.changes).toEqual([]);
      expect(warnings).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          project: 'test',
          deployment: 'test-nginx',
          path: 'test/test-nginx/web',
          message: expect.stringContaining('waiting for a node (no eligible node (no active node can run workloads))'),
        }),
      );
    });

    it('does not keep replicas on nodes that left (DR recovery): they are gone, the plan still goes through', async () => {
      const warnings: Record<string, unknown>[] = [];
      const { workload } = await plans().placeWorkloads(
        manager(),
        { after, nodesAfter: [controlPlane] },
        new Set(),
        new Set(),
        touchedWorkloads(projectOnly),
        warnings,
      );

      expect(workload.schedule.replicas).toEqual([]);
      expect(warnings).toContainEqual(
        expect.objectContaining({
          path: 'test/test-nginx/web',
          message: expect.stringContaining('waiting for a node'),
        }),
      );
    });

    it('still rejects a plan whose own workload change can not be placed', async () => {
      const issues = await issuesOf(
        plans().placeWorkloads(
          manager(),
          { after, nodesAfter: [controlPlane, offline] },
          new Set(['test/test-nginx']),
          new Set(),
          touchedWorkloads(nginxUpdate),
          [],
        ),
      );

      expect(issues).toEqual([
        expect.objectContaining({
          level: 'error',
          project: 'test',
          deployment: 'test-nginx',
          path: 'test/test-nginx/web',
          message: expect.stringContaining('no eligible node'),
        }),
      ]);
    });

    describe('image-architecture re-plan (3.35)', () => {
      const layer = {
        digest: sha('1'),
        diffId: sha('1'),
        size: 1,
        mediaType: 'application/vnd.oci.image.layer.v1.tar',
      };
      const inspection = (platform: string): ImageInspection => ({
        manifestDigest: sha('a'),
        platform,
        platforms: [],
        labels: {},
        config: { cmd: ['serve'] },
        layers: [layer],
      });
      const withStore = [...after, project('shop'), store];
      const touched = touchedWorkloads([change('create', 'Deployment', 'store', 'shop')], ['shop/store']);
      const pinned = (platform: string) => {
        const service = plans();

        service.resolveDeployments = jest.fn(async () => ({
          'shop/store': {
            images: { app: 'registry.lw/shop/app@x' },
            secretVersions: {},
            imageConfigs: { app: inspection(platform) },
          },
        }));

        return service;
      };

      it('rejects the plan when the pinned image rules out every node for the touched workload', async () => {
        const issues = await issuesOf(
          pinned('linux/arm64').placeWorkloads(
            manager(),
            { after: withStore, nodesAfter: [microvmNode, offline] },
            new Set(['shop/store']),
            new Set(),
            touched,
            [],
          ),
        );

        expect(issues).toEqual([expect.objectContaining({ level: 'error', path: 'shop/store/app' })]);
      });

      it('keeps untouched workloads waiting (noted once) when the touched one fits', async () => {
        const warnings: Record<string, unknown>[] = [];
        const { workload } = await pinned('linux/amd64').placeWorkloads(
          manager(),
          { after: withStore, nodesAfter: [microvmNode, offline] },
          new Set(['shop/store']),
          new Set(),
          touched,
          warnings,
        );

        expect(workload.schedule.replicas.map((r) => [r.replica, r.node]).sort()).toEqual([
          ['shop/store/app/0', 'amd'],
          ['test/test-nginx/web/0', 'dev-1'],
        ]);
        expect(warnings.filter((w) => String(w['message']).startsWith('waiting for a node'))).toEqual([
          expect.objectContaining({ path: 'test/test-nginx/web' }),
        ]);
      });
    });
  });

  describe('apply re-plan', () => {
    it('applies a plan next to an untouched unplaceable workload: no placement change, its replica is kept', async () => {
      const workload = await plans().replanForApply(
        manager(),
        { changes: projectOnly, deploymentStates: {}, workloadChanges: [] },
        after,
      );

      expect(workload.schedule.unschedulable).toEqual([]);
      expect(workload.schedule.replicas.map((r) => [r.replica, r.node])).toEqual([['test/test-nginx/web/0', 'dev-1']]);
    });

    it('still refuses when a touched workload lost its placement since the plan', async () => {
      await expect(
        plans().replanForApply(
          manager(),
          {
            changes: nginxUpdate,
            deploymentStates: { 'test/test-nginx': { images: {}, secretVersions: {} } },
            workloadChanges: [],
          },
          after,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
