import { envelopeDecrypt, envelopeEncrypt } from '@forepath/loadweaver/shared/util-secrets';
import type { RequestWithUser } from '@forepath/identity/backend';
import { DataSource, type SelectQueryBuilder } from 'typeorm';

import type { AccessCaller } from '../access/access.utils';
import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { AuditEventEntity } from '../entities/audit-event.entity';
import { GitConnectionEntity } from '../entities/git.entity';
import { SecretEntity } from '../entities/secret.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { SecretsService } from './secrets.service';
import { WorkloadPlannerService } from './workload-planner.service';

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
    findOne: jest.fn(),
  };
  const resources = { exists: jest.fn(), find: jest.fn().mockResolvedValue([]) };
  const metadata = { find: jest.fn().mockResolvedValue([]) };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === ResourceEntity ? resources : entity === SecretEntity ? secrets : metadata,
  };
  const dataSource = { transaction: jest.fn(async (fn) => await fn(manager)) };
  const masterKey = { current: jest.fn() };
  const audit = { record: jest.fn() };
  const access = { caller: jest.fn() };
  const key = Buffer.alloc(32, 7);
  const service = new SecretsService(
    dataSource as never,
    masterKey as never,
    audit as never,
    new WorkloadPlannerService(),
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
      project: 'shop',
      name: 'env',
      reserved: false,
      usedBy: [],
      version: 1,
      updatedBy: 'owner',
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
    });
    for (const forbidden of ['private-value', 'fingerprint', 'ciphertext', 'wrappedKey'])
      expect(JSON.stringify(result)).not.toContain(forbidden);
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

describe('SecretsService.listNames', () => {
  // Build real TypeORM SQL without opening a database connection. The execution stub models stored name/version rows.
  const dataSource = new DataSource({ type: 'postgres', entities: [SecretEntity] });
  const masterKey = { current: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new SecretsService(dataSource, masterKey as never, audit as never, {} as never, {} as never);
  let rows: { project: string; name: string; version: number }[];
  let query: SelectQueryBuilder<SecretEntity>;
  const execute = jest.fn();

  beforeAll(async () => {
    await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
  });

  beforeEach(() => {
    rows = [
      { project: 'shop', name: 'env', version: 1 },
      { project: 'shop', name: 'db-password', version: 1 },
      { project: 'shop', name: 'db-password', version: 2 },
      { project: 'shop', name: 'db-admin', version: 1 },
      { project: 'other', name: 'db-other', version: 1 },
    ];
    const repo = dataSource.getRepository(SecretEntity);
    const createQueryBuilder = repo.createQueryBuilder.bind(repo);

    execute.mockImplementation(async () => {
      const { project, q } = query.getParameters();

      return [
        ...new Set(
          rows
            .filter((r) => r.project === project && r.name.toLowerCase().includes(q.toLowerCase()))
            .map((r) => r.name),
        ),
      ]
        .sort()
        .slice(0, query.expressionMap.limit)
        .map((name) => ({ name }));
    });
    jest.spyOn(repo, 'createQueryBuilder').mockImplementation((alias) => {
      query = createQueryBuilder(alias);
      jest.spyOn(query, 'getRawMany').mockImplementation(execute);

      return query;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('selects only distinct names in one bounded query, without touching values, hashes, master keys or audit', async () => {
    expect(await service.listNames('shop')).toEqual({
      items: [{ name: 'db-admin' }, { name: 'db-password' }, { name: 'env' }],
    });
    expect(query.getQueryAndParameters()).toEqual([
      'SELECT DISTINCT "s"."name" AS "name" FROM "lw_secrets" "s" WHERE "s"."project" = $1 AND POSITION(LOWER($2) IN LOWER("s"."name")) > 0 AND LEFT("s"."name", 3) <> \'lw-\' ORDER BY "s"."name" ASC LIMIT 50',
      ['shop', ''],
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(masterKey.current).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('filters case-insensitively, sorts before limiting, and keeps versions from creating duplicate suggestions', async () => {
    expect(await service.listNames('shop', 'DB', 1)).toEqual({ items: [{ name: 'db-admin' }] });
    expect(query.getParameters()).toEqual({ project: 'shop', q: 'DB' });
    expect(query.getSql()).toContain('ORDER BY "s"."name" ASC LIMIT 1');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(['%', '_', "' OR true --"])(
    'treats %s as a literal substring, with parameter binding rather than SQL interpolation',
    async (q) => {
      expect(await service.listNames('shop', q)).toEqual({ items: [] });
      expect(query.getParameters().q).toBe(q);
      expect(query.getSql()).toContain('POSITION(LOWER($2) IN LOWER("s"."name")) > 0');
      expect(query.getQueryAndParameters()[1]).toEqual(['shop', q]);
    },
  );

  it('excludes deleted secrets: this store hard-deletes every version, with no soft-delete column', async () => {
    expect(dataSource.getMetadata(SecretEntity).deleteDateColumn).toBeUndefined();
    const repo = dataSource.getRepository(SecretEntity);
    jest
      .spyOn(service as unknown as { usages(): Promise<Map<string, never[]>> }, 'usages')
      .mockResolvedValue(new Map());

    jest
      .spyOn(dataSource, 'transaction')
      .mockImplementation(
        async (fn: never) => await (fn as (manager: unknown) => Promise<void>)({ getRepository: () => repo }),
      );
    jest.spyOn(repo, 'delete').mockImplementation(async (criteria: { project: string; name: string }) => {
      const previous = rows.length;

      rows = rows.filter((r) => r.project !== criteria.project || r.name !== criteria.name);

      return { affected: previous - rows.length, raw: [] };
    });
    await service.remove('shop', 'db-password', { type: 'system' });
    audit.record.mockClear();
    expect(await service.listNames('shop', 'db')).toEqual({ items: [{ name: 'db-admin' }] });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('allowlists the entire response, even if a repository accidentally returns extra fields', async () => {
    const row = { name: 'env' };

    for (const field of [
      'value',
      'valueBase64',
      'ciphertext',
      'wrappedKey',
      'fingerprint',
      'checksum',
      'valueLength',
    ]) {
      Object.defineProperty(row, field, {
        enumerable: true,
        get: () => {
          throw new Error('must not read value-like metadata');
        },
      });
    }
    execute.mockResolvedValue([row]);
    const result = await service.listNames('shop');

    expect(result).toEqual({ items: [{ name: 'env' }] });
    expect(Object.keys(result)).toEqual(['items']);
    expect(Object.keys(result.items[0])).toEqual(['name']);
  });
});

describe('SecretsService administration metadata and live references', () => {
  const ref = 'secret://shop/password';
  const secretRepo = { find: jest.fn(), delete: jest.fn() };
  const resourceRepo = { find: jest.fn() };
  const stateRepo = { find: jest.fn() };
  const gitRepo = { find: jest.fn() };
  const auditRepo = { find: jest.fn() };
  const audit = { record: jest.fn() };
  const access = { caller: jest.fn() };
  const repositories = new Map<unknown, unknown>([
    [SecretEntity, secretRepo],
    [ResourceEntity, resourceRepo],
    [DeploymentStateEntity, stateRepo],
    [GitConnectionEntity, gitRepo],
    [AuditEventEntity, auditRepo],
  ]);
  const manager = { getRepository: (entity: unknown) => repositories.get(entity) };
  const dataSource = { ...manager, manager, transaction: jest.fn(async (fn) => await fn(manager)) };
  const service = new SecretsService(
    dataSource as never,
    {} as never,
    audit as never,
    new WorkloadPlannerService(),
    access as never,
  );
  let resources: Partial<ResourceEntity>[];
  let rows: ReturnType<typeof row>[];
  const row = (project: string, name: string, version: number, day: string) => ({
    project,
    name,
    version,
    createdBy: 'credential',
    createdAt: new Date(`2026-10-${day}T00:00:00Z`),
  });
  const caller = (
    role?: 'admin' | 'operator' | 'developer' | 'viewer',
    clusterRole?: AccessCaller['clusterRole'],
  ): AccessCaller => ({ isApiKey: false, clusterRole, projects: new Map(role ? [['shop', role]] : []) });

  beforeEach(() => {
    resources = [
      { kind: 'Project', name: 'shop', spec: {} },
      { kind: 'Project', name: 'other', spec: {} },
    ];
    rows = [
      row('shop', 'password', 2, '29'),
      row('shop', 'password', 1, '20'),
      row('shop', 'lw-key', 1, '20'),
      row('other', 'password', 1, '20'),
    ];
    secretRepo.find.mockImplementation(async ({ where }) =>
      rows
        .filter((r) => where.project.value.includes(r.project))
        .sort((a, b) => a.name.localeCompare(b.name) || a.project.localeCompare(b.project) || b.version - a.version),
    );
    resourceRepo.find.mockImplementation(async (query) =>
      query?.where?.kind ? resources.filter((r) => r.kind === query.where.kind) : resources,
    );
    stateRepo.find.mockResolvedValue([]);
    gitRepo.find.mockResolvedValue([]);
    auditRepo.find.mockResolvedValue([
      { target: ref, details: { version: 2, onBehalfOf: 'fleet:f:person' }, actorId: 'credential', actorType: 'user' },
    ]);
    access.caller.mockResolvedValue(caller('operator'));
    secretRepo.delete.mockResolvedValue({ affected: 2 });
  });
  afterEach(() => jest.clearAllMocks());

  it('returns current versions, original creation time and the last audited fleet label; never reads value-like fields', async () => {
    const result = await service.list('shop');
    expect(result).toEqual([
      {
        project: 'shop',
        name: 'password',
        version: 2,
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-29T00:00:00.000Z',
        updatedBy: 'fleet:f:person',
        reserved: false,
        usedBy: [],
      },
    ]);
    expect(secretRepo.find.mock.calls[0][0].select).toEqual({
      project: true,
      name: true,
      version: true,
      createdAt: true,
      createdBy: true,
    });
    for (const forbidden of ['fingerprint', 'ciphertext', 'wrappedKey', 'private-value'])
      expect(JSON.stringify(result)).not.toContain(forbidden);
    expect((await service.list('shop', true)).map((r) => [r.name, r.reserved])).toEqual([
      ['lw-key', true],
      ['password', false],
    ]);
  });

  it.each(['admin', 'operator'] as const)(
    'lists only allowed projects for %s, filters literally and limits after sorting',
    async (role) => {
      expect((await service.listAll(caller(role), { q: 'PASS', limit: 1 })).map((s) => s.project)).toEqual(['shop']);
      expect(await service.listAll(caller(role), { project: 'other' })).toEqual([]);
      expect(await service.listAll(caller(role), { q: '%' })).toEqual([]);
      expect((await service.listAll(caller(undefined, 'cluster-admin'))).map((s) => `${s.project}/${s.name}`)).toEqual([
        'shop/lw-key',
        'other/password',
        'shop/password',
      ]);
    },
  );

  it.each(['developer', 'viewer', undefined] as const)(
    'returns 200-compatible empty lists for %s and infra operators without writer membership',
    async (role) => {
      expect(await service.listAll(caller(role, 'infra-operator'))).toEqual([]);
      expect(secretRepo.find).not.toHaveBeenCalled();
    },
  );

  const references = () => {
    resources.push(
      {
        kind: 'Deployment',
        name: 'app',
        project: 'shop',
        spec: {
          compose: `services:\n  web:\n    image: nginx:latest\n    secrets: [password]\n    environment: { PASSWORD: '${ref}' }\nsecrets:\n  password: { external: true }\n`,
        },
      },
      {
        kind: 'VirtualMachine',
        name: 'db',
        project: 'shop',
        labels: {},
        spec: {
          image: 'registry.lw/shop/debian:latest',
          cpu: { vcpus: 2 },
          memory: '4Gi',
          disks: [{ name: 'root', size: '20Gi', source: 'image' }],
          nics: [{ name: 'eth0', groups: ['db'] }],
          cloudInit: { userData: `#cloud-config\npassword: ${ref}\nfixed: ${ref}@1` },
        },
      },
      { kind: 'DnsProvider', name: 'dns', project: null, spec: { type: 'cloudflare', credentials: ref } },
    );
    gitRepo.find.mockResolvedValue([{ id: 'connection-id', project: 'shop', credentials: ref }]);
  };

  it('reports every live reference with applied deployment and per-VM pins, including explicit pins', async () => {
    references();
    stateRepo.find.mockResolvedValue([
      { id: 'shop/app', secretVersions: { [ref]: 1 } },
      { id: 'shop/lw-vm', secretVersions: { [`db/${ref}`]: 2 } },
    ]);
    const result = (await service.list('shop'))[0];
    expect(result.usedBy).toEqual([
      { kind: 'Deployment', project: 'shop', name: 'app', pinnedVersion: 1 },
      { kind: 'DnsProvider', project: '', name: 'dns', pinnedVersion: null },
      { kind: 'GitConnection', project: 'shop', name: 'connection-id', pinnedVersion: null },
      { kind: 'VirtualMachine', project: 'shop', name: 'db', pinnedVersion: 1 },
      { kind: 'VirtualMachine', project: 'shop', name: 'db', pinnedVersion: 2 },
    ]);
    let error: unknown;
    try {
      await service.remove('shop', 'password', { type: 'user', id: 'owner' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      status: 409,
      response: { message: 'secret is in use; remove the references first', usedBy: result.usedBy },
    });
    expect(secretRepo.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain('private-value');
  });

  it('uses null until applied, de-duplicates references and ignores removed resources and orphaned pins', async () => {
    references();
    expect((await service.list('shop'))[0].usedBy).toEqual([
      { kind: 'Deployment', project: 'shop', name: 'app', pinnedVersion: null },
      { kind: 'DnsProvider', project: '', name: 'dns', pinnedVersion: null },
      { kind: 'GitConnection', project: 'shop', name: 'connection-id', pinnedVersion: null },
      { kind: 'VirtualMachine', project: 'shop', name: 'db', pinnedVersion: null },
    ]);
    resources = resources.filter((r) => r.kind === 'Project');
    gitRepo.find.mockResolvedValue([]);
    stateRepo.find.mockResolvedValue([{ id: 'shop/app', secretVersions: { [ref]: 1 } }]);
    await service.remove('shop', 'password', { type: 'user', id: 'credential', onBehalfOf: 'fleet:f:person' });
    expect(secretRepo.delete).toHaveBeenCalledWith({ project: 'shop', name: 'password' });
    expect(audit.record.mock.calls[0][1].actor.onBehalfOf).toBe('fleet:f:person');
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
