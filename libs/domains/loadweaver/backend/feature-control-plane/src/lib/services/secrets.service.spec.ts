import { envelopeDecrypt, envelopeEncrypt } from '@forepath/loadweaver/shared/util-secrets';
import type { RequestWithUser } from '@forepath/identity/backend';

import type { AccessCaller } from '../access/access.utils';
import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { SecretEntity } from '../entities/secret.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
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

describe('SecretsService.valueForNode', () => {
  const key = Buffer.alloc(32, 7);
  const ref = 'secret://shop/db-password';
  const workloadId = 'shop/lw-vm/database/0';
  const placements = { findOne: jest.fn() };
  const desired = { findOne: jest.fn() };
  const resources = { find: jest.fn() };
  const states = { findOne: jest.fn() };
  const secrets = { findOne: jest.fn() };
  const repositories = new Map<unknown, unknown>([
    [WorkloadPlacementEntity, placements],
    [NodeDesiredStateEntity, desired],
    [ResourceEntity, resources],
    [DeploymentStateEntity, states],
    [SecretEntity, secrets],
  ]);
  const dataSource = { getRepository: jest.fn((entity) => repositories.get(entity)) };
  const masterKey = { current: jest.fn() };
  const planner = { parse: jest.fn() };
  const service = new SecretsService(
    dataSource as never,
    masterKey as never,
    {} as never,
    planner as never,
    {} as never,
  );
  const setRefs = (refs: string[], id = workloadId, project = 'shop') =>
    desired.findOne.mockResolvedValue({
      state: { workloads: [{ id, project, vm: { cloudInit: { metaData: '{}', secretRefs: refs } } }] },
    });
  const row = (version: number) => ({
    project: 'shop',
    name: 'db-password',
    version,
    keyId: 'master',
    ...envelopeEncrypt(key, Buffer.from(`private-value-${version}`), `${ref}@${version}`),
  });
  const read = (requestedRef = ref, node = 'node-1') => service.valueForNode(node, workloadId, requestedRef);
  const expectRefused = async (requestedRef = ref, node = 'node-1') => {
    await expect(read(requestedRef, node)).rejects.toMatchObject({ status: 403 });
    expect(secrets.findOne).not.toHaveBeenCalled();
    expect(masterKey.current).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    placements.findOne.mockResolvedValue({
      id: workloadId,
      project: 'shop',
      deployment: 'lw-vm',
      service: 'database',
      node: 'node-1',
      targetNode: 'node-2',
    });
    setRefs([ref]);
    resources.find.mockResolvedValue([]);
    planner.parse.mockReturnValue({ parsed: [] });
    states.findOne.mockResolvedValue({ secretVersions: { [ref]: 2 } });
    secrets.findOne.mockImplementation(async ({ where }) =>
      where.version === undefined ? row(4) : [2, 3].includes(where.version) ? row(where.version) : null,
    );
    masterKey.current.mockResolvedValue({ id: 'master', value: key });
  });

  afterEach(() => jest.clearAllMocks());

  it('returns a VM cloud-init secret on its placement node using the applied version', async () => {
    const result = await read();

    expect(result).toEqual({ version: 2, value: Buffer.from('private-value-2') });
    expect(placements.findOne).toHaveBeenCalledWith({ where: { id: workloadId } });
    expect(desired.findOne).toHaveBeenCalledWith({ where: { nodeName: 'node-1' } });
    expect(secrets.findOne).toHaveBeenCalledWith({
      where: { project: 'shop', name: 'db-password', version: 2 },
      order: { version: 'DESC' },
    });
  });

  it.each(['node-2', 'node-3'])('refuses a different node %s, including the migration target', async (node) => {
    await expectRefused(ref, node);
    expect(desired.findOne).not.toHaveBeenCalled();
  });

  it('refuses a workload without a placement', async () => {
    placements.findOne.mockResolvedValue(null);
    await expectRefused();
  });

  it('refuses a ref not listed in cloud-init or mounted', async () => {
    await expectRefused('secret://shop/unlisted');
  });

  it('refuses a cross-project ref even if listed in cloud-init', async () => {
    setRefs(['secret://other/x']);
    await expectRefused('secret://other/x');
  });

  it('returns exactly the requested pinned version 3, not the applied or latest version', async () => {
    setRefs([`${ref}@3`]);
    await expect(read(`${ref}@3`)).resolves.toEqual({ version: 3, value: Buffer.from('private-value-3') });
    expect(secrets.findOne.mock.calls[0][0].where.version).toBe(3);
  });

  it.each([0, 9])('refuses missing pinned version %s rather than falling back', async (version) => {
    setRefs([`${ref}@${version}`]);
    await expect(read(`${ref}@${version}`)).rejects.toMatchObject({ status: 404 });
    expect(secrets.findOne.mock.calls[0][0].where.version).toBe(version);
    expect(masterKey.current).not.toHaveBeenCalled();
  });

  it.each([ref, `${ref}@2`])('does not let the node replace a desired pin with %s', async (requestedRef) => {
    setRefs([`${ref}@3`]);
    await expectRefused(requestedRef);
  });

  it.each(['secret://shop/lw-reserved', 'secret://shop/lw-reserved@3'])(
    'refuses the platform-reserved cloud-init ref %s',
    async (reservedRef) => {
      setRefs([reservedRef]);
      await expectRefused(reservedRef);
    },
  );

  it.each(['missing state', 'another workload', 'another project', 'no cloud-init'])(
    'refuses cloud-init access with %s in stored desired state',
    async (scenario) => {
      if (scenario === 'missing state') desired.findOne.mockResolvedValue(null);
      if (scenario === 'another workload') setRefs([ref], 'shop/lw-vm/another/0');
      if (scenario === 'another project') setRefs([ref], workloadId, 'other');
      if (scenario === 'no cloud-init')
        desired.findOne.mockResolvedValue({ state: { workloads: [{ id: workloadId, project: 'shop' }] } });
      await expectRefused();
    },
  );

  it('keeps the latest-version fallback for an unpinned ref without an applied version', async () => {
    states.findOne.mockResolvedValue(null);
    await expect(read()).resolves.toEqual({ version: 4, value: Buffer.from('private-value-4') });
  });

  it('keeps retired master keys refused', async () => {
    masterKey.current.mockResolvedValue({ id: 'new-master', value: key });
    await expect(read()).rejects.toMatchObject({ status: 403 });
  });

  describe('non-VM workloads', () => {
    beforeEach(() => {
      placements.findOne.mockResolvedValue({
        id: 'shop/app/database/0',
        project: 'shop',
        deployment: 'app',
        service: 'database',
        node: 'node-1',
      });
      desired.findOne.mockResolvedValue(null);
    });

    it.each(['secrets', 'configs'])('keeps existing %s mount authorization and version selection', async (kind) => {
      planner.parse.mockReturnValue({
        parsed: [
          {
            project: 'shop',
            name: 'app',
            compose: {
              secrets: [],
              configs: [],
              [kind]: [{ name: 'password', ref }],
              services: [{ name: 'database', secrets: [], configs: [], [kind]: [{ source: 'password' }] }],
            },
          },
        ],
      });
      await expect(service.valueForNode('node-1', 'shop/app/database/0', ref)).resolves.toEqual({
        version: 2,
        value: Buffer.from('private-value-2'),
      });
      await expect(service.valueForNode('node-1', 'shop/app/database/0', `${ref}@3`)).resolves.toEqual({
        version: 3,
        value: Buffer.from('private-value-3'),
      });
    });

    it('still refuses unmounted secrets', async () => {
      await expect(service.valueForNode('node-1', 'shop/app/database/0', ref)).rejects.toMatchObject({ status: 403 });
      expect(secrets.findOne).not.toHaveBeenCalled();
    });
  });
});
