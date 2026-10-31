import { NodeEntity } from '../entities/node.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import type { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import {
  EGRESS_POLICIES_FEATURE,
  legacyEgressPlacementIssues,
  unfoldableEgressServices,
  withEgressFeatureRequirements,
} from '../utils/egress-steering.utils';
import { WorkloadPlannerService } from './workload-planner.service';

/**
 * Egress steering (M6 gate, carried from the M5 review): per-source egress settings that agents without
 * `egress-policies` can't apply even folded (URL deny patterns, address denies of unrestricted sources) place their
 * services only on nodes advertising the feature; no such node → the plan is refused; replicas already on older nodes
 * stay with a warning to update the agent.
 */
const GiB = 1024 ** 3;
const COMPOSE = `
services:
  runner:
    image: alpine:3
    labels: { role: ci }
  api:
    image: nginx:1.27
    networks: [back]
  web:
    image: nginx:1.27
networks:
  back: {}
`;

const resource = (kind: string, name: string, spec: Record<string, unknown>, project: string | null = 'shop') =>
  ({ kind, name, project, spec }) as unknown as ResourceEntity;

const base = [resource('Project', 'shop', {}, null), resource('Deployment', 'ci', { compose: COMPOSE })];
const urlPatterns = resource('Policy', 'ci-egress', {
  from: [{ selector: { matchLabels: { role: 'ci' } } }],
  egressMode: 'enforce',
  denyUrlPatterns: ['\\.exe$'],
});

function parsedOf(resources: ResourceEntity[]) {
  return new WorkloadPlannerService().parse(resources).parsed;
}

describe('unfoldable per-source egress settings', () => {
  it('names services whose URL deny patterns older agents would ignore', () => {
    const resources = [...base, urlPatterns];

    expect(unfoldableEgressServices(parsedOf(resources), resources)).toEqual(
      new Map([['shop/ci/runner', ['denyUrlPatterns']]]),
    );
  });

  it('ignores sources that are not filtered or offline (the fold is exact there)', () => {
    const off = resource('Policy', 'ci-egress', {
      from: [{ selector: { matchLabels: { role: 'ci' } } }],
      denyUrlPatterns: ['\\.exe$'],
    });
    const offline = resource('Policy', 'ci-egress', {
      from: [{ selector: { matchLabels: { role: 'ci' } } }],
      egressMode: 'offline',
      denyUrlPatterns: ['\\.exe$'],
    });

    expect(unfoldableEgressServices(parsedOf([...base, off]), [...base, off]).size).toBe(0);
    expect(unfoldableEgressServices(parsedOf([...base, offline]), [...base, offline]).size).toBe(0);
  });

  it('names unrestricted sources with enforced address denies, not those with an allow list', () => {
    const settings = resource('Policy', 'api-mode', { from: [{ group: 'backend' }], egressMode: 'enforce' });
    const internet = resource('Policy', 'api-out', {
      from: [{ group: 'backend' }],
      to: [{ builtin: 'internet' }],
      rules: [{ protocol: 'tcp', ports: [80, 443] }],
    });
    const deny = resource('Policy', 'api-deny', {
      action: 'deny',
      from: [{ group: 'backend' }],
      to: [{ cidr: '203.0.113.0/24' }],
      rules: [{ protocol: 'tcp', ports: [80, 443] }],
    });
    const hosts = resource('Policy', 'api-hosts', {
      from: [{ group: 'backend' }],
      to: [{ host: 'api.stripe.com' }],
      rules: [{ protocol: 'tcp', ports: [443] }],
    });
    const group = resource('WorkloadGroup', 'backend', { selector: { names: ['api'] } });
    const unrestricted = [...base, group, settings, internet, deny];
    const restricted = [...unrestricted, hosts];

    expect(unfoldableEgressServices(parsedOf(unrestricted), unrestricted)).toEqual(
      new Map([['shop/ci/api', ['denyCidrs']]]),
    );
    expect(unfoldableEgressServices(parsedOf(restricted), restricted).size).toBe(0);
  });

  it('turns them into scheduler requirements and warnings for replicas left on older nodes', () => {
    const unfoldable = new Map([['shop/ci/runner', ['denyUrlPatterns' as const]]]);
    const services = withEgressFeatureRequirements(
      [{ id: 'shop/ci/runner' }, { id: 'shop/ci/web' }] as never,
      unfoldable,
    );

    expect(services[0]).toMatchObject({
      requiredFeatures: [EGRESS_POLICIES_FEATURE],
      requiredFeaturesReason: expect.stringContaining('denyUrlPatterns'),
    });
    expect(services[1]).toEqual({ id: 'shop/ci/web' });
    expect(
      legacyEgressPlacementIssues(
        [
          { service: 'shop/ci/runner', replica: 'shop/ci/runner/0', node: 'old' },
          { service: 'shop/ci/runner', replica: 'shop/ci/runner/1', node: 'new' },
          { service: 'shop/ci/web', replica: 'shop/ci/web/0', node: 'old' },
        ],
        unfoldable,
        new Map([
          ['old', []],
          ['new', [EGRESS_POLICIES_FEATURE]],
        ]),
      ),
    ).toEqual([
      {
        level: 'warning',
        project: 'shop',
        deployment: 'ci',
        path: 'services.runner',
        message: expect.stringMatching(/replica shop\/ci\/runner\/0 stays on node old.*update the agent on old/),
      },
    ]);
  });
});

describe('planner steering', () => {
  const node = (name: string, features: string[]) =>
    Object.assign(new NodeEntity(), {
      name,
      site: 'fra1',
      labels: {},
      lifecycle: 'active',
      witness: false,
      controlPlane: false,
      capacity: { cpuMillis: 8000, memoryBytes: 16 * GiB, diskBytes: 200 * GiB },
      capabilities: {},
      lastSeenAt: new Date(),
      protocolFeatures: features,
    });

  function manager(
    placements: Partial<WorkloadPlacementEntity>[] = [],
    volumes: Partial<VolumePlacementEntity>[] = [],
  ) {
    const rows = new Map<unknown, unknown[]>([
      [WorkloadPlacementEntity, placements],
      [VolumePlacementEntity, volumes],
      [NodeDesiredStateEntity, []],
    ]);

    return {
      query: async () => [],
      getRepository: (entity: unknown) => ({ find: async () => rows.get(entity) ?? [] }),
    } as never;
  }

  const planner = new WorkloadPlannerService();
  const resources = [...base, urlPatterns];

  it('places the steered service on a node with egress-policies only', async () => {
    const plan = await planner.plan(manager(), resources, [node('n1', []), node('n2', [EGRESS_POLICIES_FEATURE])]);

    expect(plan.schedule.unschedulable).toEqual([]);
    expect(plan.schedule.replicas.find((r) => r.service === 'shop/ci/runner')?.node).toBe('n2');
  });

  it('refuses (unschedulable) when only older agents are left, naming the feature and the setting', async () => {
    const plan = await planner.plan(manager(), resources, [node('n1', []), node('n3', ['live-migration'])]);

    expect(plan.schedule.unschedulable).toEqual([
      {
        service: 'shop/ci/runner',
        replica: 'shop/ci/runner/0',
        reason: expect.stringMatching(/protocol feature egress-policies.*denyUrlPatterns.*update the node agents/),
      },
    ]);
    // Other services are unaffected.
    expect(plan.schedule.replicas.map((r) => r.service).sort()).toEqual(['shop/ci/api', 'shop/ci/web']);
  });

  it('keeps a replica already on an older node and warns to update its agent', async () => {
    const plan = await planner.plan(
      manager([{ id: 'shop/ci/runner/0', project: 'shop', deployment: 'ci', service: 'runner', node: 'n1' }]),
      resources,
      [node('n1', []), node('n2', [EGRESS_POLICIES_FEATURE])],
    );

    expect(plan.schedule.replicas.find((r) => r.service === 'shop/ci/runner')?.node).toBe('n1');
    expect(plan.changes.filter((c) => c.action === 'move')).toEqual([]);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({
        level: 'warning',
        path: 'services.runner',
        message: expect.stringContaining('update the agent on n1'),
      }),
    );
  });

  it('lists the copy a re-plan adds once a held-back node is ready ("copy added on <node>")', async () => {
    const stateful = [
      resource('Project', 'shop', {}, null),
      resource('Deployment', 'db', {
        compose: `
services:
  pg:
    image: postgres:16
    volumes: [data:/var/lib/postgresql/data]
volumes:
  data: { x-loadweaver: { size: 1g } }
`,
      }),
    ];
    const placements = [{ id: 'shop/db/pg/0', project: 'shop', deployment: 'db', service: 'pg', node: 'n1' }];
    const volumes = [{ id: 'shop/db/data', primaryNode: 'n1', syncReplicas: [], remoteReplicas: [] }];
    const joining = Object.assign(node('n2', [EGRESS_POLICIES_FEATURE]), { joinedAt: new Date(), connected: false });
    const held = await planner.plan(manager(placements, volumes), stateful, [node('n1', []), joining]);
    const ready = await planner.plan(manager(placements, volumes), stateful, [
      node('n1', []),
      node('n2', [EGRESS_POLICIES_FEATURE]),
    ]);

    expect(held.changes).toEqual([]);
    expect(held.issues).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('gets no copy on n2') }),
    );
    expect(ready.changes).toEqual([{ action: 'copy', volume: 'shop/db/data', to: 'n2', copy: 'sync' }]);
  });
});
