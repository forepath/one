import { UserEntity, type RequestWithUser } from '@forepath/identity/backend';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { AccessCaller } from '../access/access.utils';
import type { ProjectAccessService } from '../access/project-access.service';
import type { AuditLogService } from '../services/audit-log.service';
import type { PlansService } from '../services/plans.service';
import type { TopologyService } from '../topology/topology.service';
import type { DraftEntity } from './draft.entity';
import { DraftsService } from './drafts.service';

jest.mock('../services/audit-log.service', () => ({
  actorFromRequest: (req?: { actor?: unknown }) => req?.actor ?? { type: 'api-key', id: null },
  AuditLogService: class {},
}));

const deployment = (name: string, image = 'nginx:1') => `apiVersion: loadweaver.com/v1
kind: Deployment
metadata:
  name: ${name}
  project: shop
spec:
  compose: |
    services:
      web:
        image: ${image}
`;

type Req = RequestWithUser & { actor: { type: string; id: string; person?: string } };
const as = (id: string): Req => ({ actor: { type: 'user', id } }) as unknown as Req;

function setup(callers: Record<string, Partial<AccessCaller>> = {}) {
  const rows = new Map<string, DraftEntity>();
  let seq = 0;
  const generations = new Map<string, number>([['Deployment/shop/web', 4]]);
  const repo = {
    count: jest.fn(
      async ({ where }: { where: Partial<DraftEntity> }) =>
        [...rows.values()].filter((d) => d.owner === where.owner && d.status === where.status).length,
    ),
    create: (d: Partial<DraftEntity>) => ({ ...d }) as DraftEntity,
    save: jest.fn(async (d: DraftEntity) => {
      const now = new Date();
      const saved = {
        ...d,
        id: d.id ?? `00000000-0000-4000-8000-00000000000${++seq}`,
        createdAt: d.createdAt ?? now,
        updatedAt: now,
      };

      rows.set(saved.id, structuredClone(saved));

      return saved;
    }),
    find: jest.fn(async ({ where }: { where: Partial<DraftEntity> }) =>
      [...rows.values()].filter((d) => d.status === where.status).map((d) => structuredClone(d)),
    ),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      const d = rows.get(where.id);

      return d ? structuredClone(d) : null;
    }),
    update: jest.fn(async (criteria: Partial<DraftEntity>, patch: Partial<DraftEntity>) => {
      const d = rows.get(criteria.id as string);

      if (d && (!criteria.status || d.status === criteria.status)) rows.set(d.id, { ...d, ...patch });
    }),
  };
  const manager = {
    getRepository: () => repo,
    query: jest.fn(async (_sql: string, [kinds, names]: [string[], string[]]) =>
      [...generations.entries()]
        .map(([key, generation]) => {
          const [kind, project, name] = key.split('/');

          return { kind, project: project || null, name, generation };
        })
        .filter((r) => kinds.includes(r.kind) && names.includes(r.name)),
    ),
  };
  const dataSource = {
    manager,
    getRepository: () => repo,
    transaction: async <T>(cb: (m: typeof manager) => Promise<T>) => await cb(manager),
  } as unknown as DataSource;
  const access = {
    caller: jest.fn(async (req?: Req) => ({
      isApiKey: false,
      projects: new Map([['shop', 'developer']]),
      ...(callers[req?.actor.id ?? ''] ?? {}),
    })),
  } as unknown as ProjectAccessService;
  const audit = { record: jest.fn(async () => ({})) } as unknown as AuditLogService & { record: jest.Mock };
  const plans = {
    create: jest.fn(async (dto: { dryRun?: boolean }) => ({
      id: dto.dryRun ? 'dry-run' : 'plan-1',
      changes: [{ action: 'update', kind: 'Deployment', name: 'web', project: 'shop' }],
      ...(dto.dryRun ? { dryRun: true } : {}),
    })),
  } as unknown as PlansService & { create: jest.Mock };
  const topology = {
    topology: jest.fn(async () => ({
      elements: [],
      edges: [],
      at: 'now',
      overlay: { 'replica:shop/web/web/0': 'update' },
    })),
  } as unknown as TopologyService & { topology: jest.Mock };
  const service = new DraftsService(dataSource, access, audit, plans, topology);

  return { service, rows, generations, audit, plans, topology, dataSource, repo };
}

describe('DraftsService (3.36)', () => {
  it('creates a draft with ops at their current generation, scoped and audited', async () => {
    const { service, audit } = setup();
    const draft = await service.create(as('u1'), {
      title: ' Scale web ',
      ops: [
        { op: 'upsert', document: deployment('web') },
        { op: 'delete', kind: 'Deployment', name: 'old', project: 'shop' },
      ],
    });

    expect(draft).toMatchObject({
      title: 'Scale web',
      owner: 'u1',
      projects: ['shop'],
      clusterScope: null,
      version: 1,
    });
    expect(draft.ops.map((o) => [o.op, o.kind, o.name, o.baseGeneration])).toEqual([
      ['upsert', 'Deployment', 'web', 4],
      ['delete', 'Deployment', 'old', 0],
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'draft.create', target: `draft/${draft.id}`, project: 'shop' }),
    );
  });

  it('refuses ops on projects the caller may not write', async () => {
    const { service } = setup({ viewer: { projects: new Map([['shop', 'viewer']]) } });

    await expect(
      service.create(as('viewer'), { title: 't', ops: [{ op: 'upsert', document: deployment('web') }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records the verified fleet person as the owner (3.24)', async () => {
    const { service } = setup();
    const req = { actor: { type: 'user', id: 'svc', person: 'fleet:iss:alice' } } as unknown as Req;

    expect((await service.create(req, { title: 't' })).owner).toBe('fleet:iss:alice');
  });

  it('patches under optimistic concurrency and answers 409 with the current draft', async () => {
    const { service } = setup();
    const created = await service.create(as('u1'), { title: 't' });
    const v2 = await service.patch(as('u1'), created.id, {
      version: 1,
      set: [{ op: 'upsert', document: deployment('web') }],
    });

    expect(v2.version).toBe(2);
    expect(v2.projects).toEqual(['shop']);

    const stale = service.patch(as('u1'), created.id, { version: 1, title: 'x' });

    await expect(stale).rejects.toBeInstanceOf(ConflictException);
    await stale.catch((e: ConflictException) =>
      expect(e.getResponse()).toMatchObject({ message: 'draft changed', draft: { version: 2 } }),
    );

    const v3 = await service.patch(as('u1'), created.id, { version: 2, remove: ['Deployment/shop/web'] });

    expect(v3.ops).toEqual([]);
    expect(v3.projects).toEqual([]);
  });

  it('shares a draft with writers of its projects only; others get 404', async () => {
    const { service } = setup({
      bob: { projects: new Map([['shop', 'operator']]) },
      eve: { projects: new Map([['blog', 'admin']]) },
    });
    const created = await service.create(as('u1'), {
      title: 't',
      ops: [{ op: 'upsert', document: deployment('web') }],
    });

    expect((await service.get(as('bob'), created.id)).id).toBe(created.id);
    expect((await service.list(as('bob'))).map((d) => d.id)).toEqual([created.id]);
    await expect(service.get(as('eve'), created.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.list(as('eve'))).toEqual([]);
    expect((await service.patch(as('bob'), created.id, { version: 1, title: 'by bob' })).title).toBe('by bob');
  });

  it('labels the owner by email on list / get for the drafts the caller sees (D11, LW-14)', async () => {
    const ALICE = '6f1c1b0e-0000-4000-8000-000000000001';
    const { service, dataSource, repo } = setup({ bob: { projects: new Map([['shop', 'operator']]) } });
    const users = { find: jest.fn(async () => [{ id: ALICE, email: 'alice@example.com' }]) };

    (dataSource as unknown as { getRepository: (entity: unknown) => unknown }).getRepository = (entity) =>
      entity === UserEntity ? users : repo;

    const mine = await service.create(as(ALICE), { title: 'a', ops: [{ op: 'upsert', document: deployment('web') }] });
    const key = await service.create(undefined, { title: 'k', ops: [{ op: 'upsert', document: deployment('api') }] });

    // Writes stay as they were (no lookup); reads carry the label.
    expect(mine).not.toHaveProperty('ownerEmail');
    expect((await service.get(as('bob'), mine.id)).ownerEmail).toBe('alice@example.com');

    const listed = await service.list(as('bob'));

    expect(listed.map((d) => [d.owner, d.ownerEmail])).toEqual(
      expect.arrayContaining([
        [ALICE, 'alice@example.com'],
        ['api-key', null],
      ]),
    );
    expect(listed.map((d) => d.id)).toEqual(expect.arrayContaining([mine.id, key.id]));
    // One batched lookup per list, only for native user ids.
    expect(users.find).toHaveBeenCalledTimes(2);
  });

  it('previews as a dry run with the map overlay and conflicts', async () => {
    const { service, plans, generations } = setup();
    const created = await service.create(as('u1'), {
      title: 't',
      ops: [{ op: 'upsert', document: deployment('web') }],
    });

    generations.set('Deployment/shop/web', 5);

    const preview = await service.preview(as('u1'), created.id);

    expect(plans.create).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, documents: expect.any(String) }),
      expect.anything(),
    );
    expect(preview.plan).toMatchObject({ id: 'dry-run', dryRun: true });
    expect(preview.topology.overlay).toEqual({ 'replica:shop/web/web/0': 'update' });
    expect(preview.conflicts).toEqual([
      expect.objectContaining({ key: 'Deployment/shop/web', baseGeneration: 4, currentGeneration: 5 }),
    ]);
  });

  it('refuses to submit conflicting ops, then submits a rebased draft as a plan', async () => {
    const { service, plans, generations, rows, audit } = setup();
    const created = await service.create(as('u1'), {
      title: 'web',
      ops: [{ op: 'upsert', document: deployment('web') }],
    });

    generations.set('Deployment/shop/web', 5);
    await expect(service.submit(as('u1'), created.id, 1)).rejects.toBeInstanceOf(ConflictException);
    expect(rows.get(created.id)?.status).toBe('open');

    const rebased = await service.patch(as('u1'), created.id, {
      version: 1,
      set: [{ op: 'upsert', document: deployment('web', 'nginx:2'), baseGeneration: 5 }],
    });
    const plan = await service.submit(as('u1'), created.id, rebased.version);

    expect(plan.id).toBe('plan-1');
    expect(plans.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ documents: expect.stringContaining('nginx:2') }),
      expect.anything(),
      { draft: { id: created.id, title: 'web' } },
    );
    expect(rows.get(created.id)).toMatchObject({ status: 'submitted', planId: 'plan-1' });
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'draft.submit' }));
    await expect(service.submit(as('u1'), created.id, rows.get(created.id)?.version as number)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('reopens the draft when the plan is refused', async () => {
    const { service, plans, rows } = setup();
    const created = await service.create(as('u1'), {
      title: 't',
      ops: [{ op: 'upsert', document: deployment('web') }],
    });

    plans.create.mockRejectedValueOnce(new Error('invalid'));
    await expect(service.submit(as('u1'), created.id, 1)).rejects.toThrow('invalid');
    expect(rows.get(created.id)).toMatchObject({ status: 'open', version: 3 });
  });

  it('discards (audited) and keeps discarded drafts out of the open list', async () => {
    const { service, audit } = setup();
    const created = await service.create(as('u1'), { title: 't' });

    expect((await service.discard(as('u1'), created.id, 1)).status).toBe('discarded');
    expect(await service.list(as('u1'))).toEqual([]);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'draft.discard' }));
  });
});
