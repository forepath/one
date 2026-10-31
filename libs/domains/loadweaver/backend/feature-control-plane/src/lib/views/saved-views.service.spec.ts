import type { RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { AccessCaller } from '../access/access.utils';
import type { ProjectAccessService } from '../access/project-access.service';
import type { AuditLogService } from '../services/audit-log.service';
import type { SavedViewEntity } from './saved-view.entity';
import { MAX_SAVED_VIEWS_PER_OWNER, SavedViewsService } from './saved-views.service';

jest.mock('../services/audit-log.service', () => ({
  actorFromRequest: () => ({ type: 'user', id: 'x' }),
  AuditLogService: class {},
  ON_BEHALF_OF_SCOPE: 'fleet:on-behalf-of',
}));

const person = 'fleet:fleet-test:u1';
const fleetUser = { amr: ['pat'], scopes: ['cluster:read', 'fleet:on-behalf-of'] };
const native = (id: string) => ({ user: { amr: ['pwd'] }, as: id }) as unknown as RequestWithUser;
const verified = { user: fleetUser, fleetIdentity: { person }, as: person } as unknown as RequestWithUser;
const unverified = { user: fleetUser, as: 'svc-fleet' } as unknown as RequestWithUser;
const apiKey = { as: 'api-key' } as unknown as RequestWithUser;

function setup() {
  const rows = new Map<string, SavedViewEntity>();
  let seq = 0;
  const matches = (v: SavedViewEntity, where: Partial<SavedViewEntity>) =>
    Object.entries(where).every(([k, value]) => v[k as keyof SavedViewEntity] === value);
  const repo = {
    count: jest.fn(
      async ({ where }: { where: Partial<SavedViewEntity> }) =>
        [...rows.values()].filter((v) => matches(v, where)).length,
    ),
    create: (v: Partial<SavedViewEntity>) => ({ ...v }) as SavedViewEntity,
    save: jest.fn(async (v: SavedViewEntity) => {
      const now = new Date();
      const saved = {
        ...v,
        id: v.id ?? `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
        createdAt: v.createdAt ?? now,
        updatedAt: now,
      };

      rows.set(saved.id, structuredClone(saved));

      return saved;
    }),
    find: jest.fn(async ({ where }: { where: Partial<SavedViewEntity> }) =>
      [...rows.values()]
        .filter((v) => matches(v, where))
        .sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name))
        .map((v) => structuredClone(v)),
    ),
    findOne: jest.fn(async ({ where }: { where: Partial<SavedViewEntity> }) => {
      const v = [...rows.values()].find((r) => matches(r, where));

      return v ? structuredClone(v) : null;
    }),
    delete: jest.fn(async (where: Partial<SavedViewEntity>) => {
      for (const v of [...rows.values()].filter((r) => matches(r, where))) rows.delete(v.id);
    }),
  };
  const manager = { getRepository: () => repo };
  const dataSource = {
    getRepository: () => repo,
    transaction: async <T>(cb: (m: typeof manager) => Promise<T>) => await cb(manager),
  } as unknown as DataSource;
  const access = {
    caller: jest.fn(
      async (req?: { as?: string }): Promise<AccessCaller> =>
        req?.as === 'api-key'
          ? { isApiKey: true, projects: new Map() }
          : { userId: req?.as, isApiKey: false, projects: new Map() },
    ),
  } as unknown as ProjectAccessService;
  const audit = { record: jest.fn(async () => ({})) } as unknown as AuditLogService & { record: jest.Mock };
  const service = new SavedViewsService(dataSource, access, audit);

  return { service, rows, repo, audit };
}

describe('SavedViewsService (3.37)', () => {
  it('creates, lists (own only, sorted), updates and deletes views, audited', async () => {
    const { service, audit } = setup();
    const b = await service.create(native('alice'), { scope: 'plans', name: ' Mine ', state: { q: 'status:open' } });

    await service.create(native('alice'), { scope: 'contents', name: 'All', state: {} });
    await service.create(native('bob'), { scope: 'plans', name: 'Mine', state: {} });

    expect(b).toMatchObject({ scope: 'plans', name: 'Mine', state: { q: 'status:open' } });
    expect(typeof b.createdAt).toBe('string');
    expect((await service.list(native('alice'))).map((v) => `${v.scope}/${v.name}`)).toEqual([
      'contents/All',
      'plans/Mine',
    ]);
    expect((await service.list(native('alice'), 'plans')).map((v) => v.id)).toEqual([b.id]);

    const updated = await service.update(native('alice'), b.id, { name: 'Open', state: { q: 'x' } });

    expect(updated).toMatchObject({ name: 'Open', state: { q: 'x' } });
    await service.remove(native('alice'), b.id);
    expect(await service.list(native('alice'), 'plans')).toEqual([]);
    expect(audit.record.mock.calls.map((c) => [c[1].action, c[1].target])).toEqual([
      ['view.create', 'view/plans/Mine'],
      ['view.create', 'view/contents/All'],
      ['view.create', 'view/plans/Mine'],
      ['view.update', 'view/plans/Open'],
      ['view.delete', 'view/plans/Open'],
    ]);
    expect(audit.record.mock.calls[3][1].details).toMatchObject({ renamedFrom: 'Mine', state: true });
  });

  it('refuses duplicates per owner + scope (409) and other owners’ views (404)', async () => {
    const { service } = setup();
    const a = await service.create(native('alice'), { scope: 'plans', name: 'Mine', state: {} });
    const other = await service.create(native('alice'), { scope: 'plans', name: 'Other', state: {} });

    await expect(service.create(native('alice'), { scope: 'plans', name: 'Mine', state: {} })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.update(native('alice'), other.id, { name: 'Mine' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.update(native('bob'), a.id, { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(native('bob'), a.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps a lost unique race to 409', async () => {
    const { service, repo } = setup();

    repo.save.mockRejectedValueOnce(Object.assign(new Error('dup'), { driverError: { code: '23505' } }));
    await expect(service.create(native('alice'), { scope: 'plans', name: 'Mine', state: {} })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('validates state (object, ≤ 16 KiB), the patch and the per-owner limit', async () => {
    const { service, rows } = setup();

    for (const state of [[], null, 'x', { big: 'x'.repeat(16 * 1024) }])
      await expect(service.create(native('alice'), { scope: 'plans', name: 'n', state })).rejects.toBeInstanceOf(
        BadRequestException,
      );

    const a = await service.create(native('alice'), { scope: 'plans', name: 'n', state: {} });

    await expect(service.update(native('alice'), a.id, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(native('alice'), a.id, { name: '  ' })).rejects.toBeInstanceOf(BadRequestException);

    for (let i = rows.size; i < MAX_SAVED_VIEWS_PER_OWNER; i++)
      rows.set(`r${i}`, { id: `r${i}`, owner: 'alice', scope: 's', name: `v${i}` } as SavedViewEntity);

    await expect(service.create(native('alice'), { scope: 'plans', name: 'more', state: {} })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect((await service.create(native('bob'), { scope: 'plans', name: 'n', state: {} })).name).toBe('n');
  });

  it('stores fleet views for the verified person, never the service account; API keys share `api-key`', async () => {
    const { service, rows } = setup();

    await service.create(verified, { scope: 'tree', name: 'Placement', state: { view: 'placement' } });
    expect([...rows.values()][0].owner).toBe(person);
    expect(await service.list(unverified)).toEqual([]);
    await expect(service.create(unverified, { scope: 'tree', name: 'x', state: {} })).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    await service.create(apiKey, { scope: 'settings', name: 'density', state: { density: 'compact' } });
    expect([...rows.values()][1].owner).toBe('api-key');
    await expect(
      service.create({ user: { amr: ['pwd'] } } as unknown as RequestWithUser, { scope: 's', name: 'x', state: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
