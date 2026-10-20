import { envelopeDecrypt } from '@forepath/loadweaver/shared/util-secrets';
import type { RequestWithUser } from '@forepath/identity/backend';

import type { AccessCaller } from '../access/access.utils';
import { ResourceEntity } from '../entities/resource.entity';
import { SecretsService } from './secrets.service';

describe('SecretsService', () => {
  const actor = { type: 'user' as const, id: 'owner' };
  const req = { user: { id: 'owner' } } as unknown as RequestWithUser;
  const query = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const secrets = {
    createQueryBuilder: () => query,
    create: jest.fn((row) => row),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const resources = { exists: jest.fn() };
  const manager = { getRepository: (entity: unknown) => (entity === ResourceEntity ? resources : secrets) };
  const dataSource = { transaction: jest.fn(async (fn) => await fn(manager)) };
  const masterKey = { current: jest.fn() };
  const audit = { record: jest.fn() };
  const access = { caller: jest.fn() };
  const key = Buffer.alloc(32, 7);
  const service = new SecretsService(
    dataSource as never,
    masterKey as never,
    audit as never,
    {} as never,
    access as never,
  );
  const write = async (method: 'set' | 'remove', name = 'lw-reserved', request = req) =>
    method === 'set'
      ? await service.setValue('shop', name, Buffer.from('private-value'), actor, { req: request })
      : await service.remove('shop', name, actor, { req: request });

  beforeEach(() => {
    access.caller.mockResolvedValue({ isApiKey: false, projects: new Map() } satisfies AccessCaller);
    resources.exists.mockResolvedValue(true);
    query.getOne.mockResolvedValue(null);
    secrets.save.mockImplementation(async (row) => ({ ...row, createdAt: new Date('2026-10-20T00:00:00Z') }));
    secrets.delete.mockResolvedValue({ affected: 1 });
    masterKey.current.mockResolvedValue({ id: 'master', value: key });
  });

  afterEach(() => jest.clearAllMocks());

  describe.each(['set', 'remove'] as const)('%s', (method) => {
    it.each(['admin', 'operator', 'developer', 'viewer'] as const)(
      'denies direct reserved-name calls by a project %s',
      async (role) => {
        access.caller.mockResolvedValue({ userId: 'owner', isApiKey: false, projects: new Map([['shop', role]]) });
        await expect(write(method)).rejects.toMatchObject({ status: 403 });
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('denies reserved names without a request or cluster-admin role', async () => {
      await expect(
        method === 'set'
          ? service.setValue('shop', 'lw-reserved', Buffer.from('private-value'), actor)
          : service.remove('shop', 'lw-reserved', actor),
      ).rejects.toMatchObject({ status: 403 });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('allows reserved names for a cluster admin', async () => {
      access.caller.mockResolvedValue({ isApiKey: false, clusterRole: 'cluster-admin', projects: new Map() });
      await write(method);
      expect(access.caller).toHaveBeenCalledWith(req);
      expect(audit.record).toHaveBeenCalled();
    });

    it('audits actor, project and secret name, never the value', async () => {
      await write(method, 'env');
      const entry = audit.record.mock.calls[0][1];

      expect(entry).toMatchObject({
        actor,
        project: 'shop',
        target: 'secret://shop/env',
        action: `secret.${method === 'set' ? 'set' : 'delete'}`,
      });
      expect(JSON.stringify(entry)).not.toContain('private-value');
      expect(entry.details).not.toHaveProperty('value');
      expect(entry.details).not.toHaveProperty('valueBase64');
    });
  });

  it('stores encrypted values and wrapped data keys, returning metadata only', async () => {
    const result = await service.setValue('shop', 'env', Buffer.from('private-value'), actor);
    const row = secrets.save.mock.calls[0][0];

    expect(row.ciphertext.includes(Buffer.from('private-value'))).toBe(false);
    expect(envelopeDecrypt(key, row, 'secret://shop/env@1').toString()).toBe('private-value');
    expect(result).toEqual({
      version: 1,
      fingerprint: row.fingerprint,
      createdBy: 'owner',
      createdAt: '2026-10-20T00:00:00.000Z',
    });
  });

  it('keeps the internal platform volume-key creation path', async () => {
    await service.setValue('shop', 'lw-volume-store.data', Buffer.alloc(64, 9), { type: 'system' }, { internal: true });
    expect(access.caller).not.toHaveBeenCalled();
    expect(secrets.save).toHaveBeenCalled();
  });

  it('does not let a user bypass reserved-name authorization with the internal option', async () => {
    await expect(
      service.setValue('shop', 'lw-reserved', Buffer.from('private'), actor, { internal: true, req }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.setValue('shop', 'lw-reserved', Buffer.from('private'), actor, { internal: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('returns 404 for an authorized write to a missing project', async () => {
    resources.exists.mockResolvedValue(false);
    await expect(write('set', 'env')).rejects.toMatchObject({ status: 404 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns 404 for an authorized delete of a missing secret', async () => {
    secrets.delete.mockResolvedValue({ affected: 0 });
    await expect(write('remove', 'env')).rejects.toMatchObject({ status: 404 });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
