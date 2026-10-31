import { NodeEntity } from '../entities/node.entity';
import { PlanEntity } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { PlansService } from './plans.service';

/** Dry-run plans (3.36 B2): the full plan is built and returned, nothing is stored, no events. */
describe('PlansService.create dry run (3.36 B2)', () => {
  const documents = `apiVersion: loadweaver.com/v1
kind: Dashboard
metadata:
  name: ops
  project: shop
spec:
  title: Ops
  widgets: []
`;

  function setup() {
    const save = jest.fn(async (x: Record<string, unknown>) => ({ ...x, id: 'stored', createdAt: new Date() }));
    const findOne = jest.fn(async () => null);
    const repos = new Map<unknown, unknown>([
      [NodeEntity, { find: async () => [] }],
      [ResourceEntity, { find: async () => [] }],
      [PlanEntity, { create: (x: Record<string, unknown>) => ({ ...x }), save, findOne }],
    ]);
    const service = Object.create(PlansService.prototype) as PlansService;
    const events = { planCreated: jest.fn() };

    Object.assign(service, {
      dataSource: {
        getRepository: (e: unknown) => repos.get(e),
        transaction: async () => [],
        query: async () => [],
      },
      resources: { findOne: async () => null },
      projectAccess: {
        caller: async () => ({ userId: 'u1', isApiKey: false, projects: new Map([['shop', 'developer']]) }),
      },
      access: { assert: jest.fn() },
      planner: { parse: () => ({ parsed: [] }) },
      events,
    });

    return { service, save, findOne, events };
  }

  it('returns the built plan without storing it or emitting events', async () => {
    const { service, save, findOne, events } = setup();
    const plan = await service.create({ documents, dryRun: true }, { user: { id: 'u1' } } as never);

    expect(plan).toMatchObject({
      id: 'dry-run',
      dryRun: true,
      status: 'pending',
      changes: [expect.objectContaining({ action: 'create', kind: 'Dashboard', name: 'ops', project: 'shop' })],
      creatorRoles: { shop: 'developer' },
    });
    expect(save).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
    expect(events.planCreated).not.toHaveBeenCalled();
  });

  it('stores and announces a real plan', async () => {
    const { service, save, events } = setup();
    const plan = await service.create({ documents }, { user: { id: 'u1' } } as never);

    expect(save).toHaveBeenCalledTimes(1);
    expect(events.planCreated).toHaveBeenCalledTimes(1);
    expect(plan.dryRun).toBeUndefined();
  });
});
