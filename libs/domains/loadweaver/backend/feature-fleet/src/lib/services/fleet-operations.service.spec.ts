import { Readable } from 'node:stream';

import { ForbiddenException } from '@nestjs/common';

import type { FleetOperationEntity } from '../entities/fleet-operation.entity';
import { clusterAccess, type FleetCaller } from '../utils/fleet-access.utils';
import { FleetClusterError } from './fleet-cluster-client.service';
import { FleetOperationsService } from './fleet-operations.service';

const SRC = '00000000-0000-4000-8000-00000000000a';
const DST = '00000000-0000-4000-8000-00000000000b';
const B1 = '11111111-1111-4111-8111-111111111111';
const caller: FleetCaller = { userId: 'u1', isApiKey: false, isAdmin: false, label: 'fleet:alice' };
const cluster = (id: string, name: string) => ({
  id,
  name,
  state: 'active',
  readOnlyUntil: null,
  endpoint: `https://${name}.example.com`,
  credential: 'pat',
  caCertificate: null,
  updatedAt: new Date(),
  health: { state: 'healthy' },
});

interface Call {
  cluster: string;
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
  onBehalfOf?: string;
}

function setup(
  options: { grants?: Record<string, { role: 'viewer' | 'operator' | 'admin'; project: string | null }[]> } = {},
) {
  const store = new Map<string, FleetOperationEntity>();
  const calls: Call[] = [];
  const responses = new Map<string, unknown>();
  const failures = new Map<string, FleetClusterError>();
  const clusters = { [SRC]: cluster(SRC, 'eu'), [DST]: cluster(DST, 'us') };
  const operations = {
    create: (v: Partial<FleetOperationEntity>) => v,
    save: jest.fn(async (v: FleetOperationEntity) => {
      const row = {
        id: v.id ?? 'abcdef12-0000-4000-8000-000000000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...v,
      };

      store.set(row.id, row as FleetOperationEntity);

      return row;
    }),
    findOne: jest.fn(async ({ where }: { where: { id?: string } }) =>
      where.id ? (store.get(where.id) ?? null) : null,
    ),
    find: jest.fn(async () => []),
  };
  const clusterRepo = { findOne: jest.fn(async ({ where }: { where: { id: string } }) => clusters[where.id] ?? null) };
  const grants = options.grants ?? {
    [SRC]: [{ role: 'operator', project: 'shop' }],
    [DST]: [{ role: 'operator', project: 'shop' }],
  };
  const access = {
    visibleCluster: jest.fn(async (_c: FleetCaller, id: string) => ({
      cluster: clusters[id],
      access: clusterAccess(caller, grants[id] ?? [], clusters[id] as never),
    })),
    visibleClusters: jest.fn(async () => []),
  };
  const key = (c: string, method: string, path: string) => `${c} ${method} ${path}`;
  const client = {
    json: jest.fn(async (c: { name: string }, r: Call) => {
      calls.push({ ...r, cluster: c.name });

      const failure = failures.get(key(c.name, r.method, r.path));

      if (failure) throw failure;

      return { data: responses.get(key(c.name, r.method, r.path)) ?? {}, headers: {} };
    }),
    stream: jest.fn(async (c: { name: string }, r: Call) => {
      calls.push({ ...r, cluster: c.name });

      return { status: 200, headers: { 'content-length': '5' }, data: Readable.from([Buffer.from('tar!!')]) };
    }),
  };
  const audit = { record: jest.fn(), recordQuietly: jest.fn() };
  const queue = { add: jest.fn(), getJob: jest.fn(async () => undefined) };
  const service = new FleetOperationsService(
    operations as never,
    clusterRepo as never,
    access as never,
    client as never,
    audit as never,
    queue as never,
  );

  return { service, store, calls, responses, failures, queue, audit, key };
}

describe('cross-cluster restore orchestration (3.20)', () => {
  it('checks the caller as operator of the backup project on the source and the target project', async () => {
    const { service, responses, key } = setup({
      grants: { [SRC]: [{ role: 'viewer', project: null }], [DST]: [{ role: 'operator', project: 'shop' }] },
    });

    responses.set(key('eu', 'GET', `backups/${B1}`), { id: B1, project: 'shop', status: 'succeeded' });

    await expect(
      service.createRestore(caller, {
        kind: 'cross-cluster-restore',
        sourceClusterId: SRC,
        targetClusterId: DST,
        backups: [{ backupId: B1, volume: 'data' }],
        target: { project: 'shop', deployment: 'web' },
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('runs validate → transfer → plan → apply → wait for the restore, with on-behalf-of on every call', async () => {
    const { service, store, calls, responses, queue, key, audit } = setup();

    responses.set(key('eu', 'GET', `backups/${B1}`), {
      id: B1,
      project: 'shop',
      status: 'succeeded',
      resource: 'shop/web/data',
    });
    responses.set(key('us', 'POST', 'backups/imports'), { id: 'imported-1' });
    responses.set(key('us', 'POST', 'plans'), { id: 'plan-1', status: 'pending' });
    responses.set(key('us', 'POST', 'plans/plan-1/apply'), { status: 'applying' });

    const created = await service.createRestore(caller, {
      kind: 'cross-cluster-restore',
      sourceClusterId: SRC,
      targetClusterId: DST,
      backups: [{ backupId: B1, volume: 'data' }],
      target: { project: 'shop', deployment: 'web' },
      apply: true,
    });

    expect(created.status).toBe('running');
    expect(queue.add).toHaveBeenCalledWith(
      'fleet-operation-step',
      { operationId: created.id },
      expect.objectContaining({ jobId: expect.stringContaining('validate') }),
    );

    // validate, transfer, restore-plan run back to back; restore-apply waits for the apply.
    for (let i = 0; i < 4; i++) await service.runStep(created.id);

    let op = store.get(created.id) as FleetOperationEntity;

    expect(op.steps.map((s) => s.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'waiting', 'pending']);
    expect(op.status).toBe('waiting');

    const transfer = calls.find((c) => c.path === 'backups/imports');

    expect(transfer).toMatchObject({
      cluster: 'us',
      method: 'POST',
      query: { volume: 'shop/web/data', sourceCluster: 'eu', sourceBackup: B1 },
      headers: { 'content-type': 'application/x-tar', 'content-length': '5' },
      onBehalfOf: 'fleet:alice',
    });
    expect(calls.find((c) => c.path === `backups/${B1}/archive`)).toMatchObject({ cluster: 'eu', method: 'GET' });

    const plan = calls.find((c) => c.method === 'POST' && c.path === 'plans');
    const documents = (plan?.body as { documents: string }).documents;

    expect(JSON.parse(documents)).toMatchObject({
      kind: 'Restore',
      metadata: { project: 'shop' },
      spec: { backup: 'imported-1', target: { deployment: 'web', volume: 'data', mode: 'replace' } },
    });
    expect(calls.every((c) => c.onBehalfOf === 'fleet:alice')).toBe(true);

    // The plan gets applied (approvals done), then the restore finishes.
    responses.set(key('us', 'GET', 'plans/plan-1'), { status: 'applied' });
    await service.runStep(created.id);
    responses.set(key('us', 'GET', 'backups/restores'), [{ name: 'fleet-abcdef12-data', status: 'running' }]);
    await service.runStep(created.id);
    expect(store.get(created.id)?.status).toBe('waiting');
    responses.set(key('us', 'GET', 'backups/restores'), [{ name: 'fleet-abcdef12-data', status: 'done' }]);
    await service.runStep(created.id);

    op = store.get(created.id) as FleetOperationEntity;
    expect(op.status).toBe('succeeded');
    expect(calls.filter((c) => c.path === 'plans/plan-1/apply')).toHaveLength(1);
    expect(audit.recordQuietly).toHaveBeenCalledWith(
      null,
      'operation.cross-cluster-restore.succeeded',
      `operation/${op.id}`,
      expect.anything(),
      DST,
    );
  });

  it('fails the operation when the target deployment is missing (nothing transferred)', async () => {
    const { service, store, calls, responses, failures, key } = setup();

    responses.set(key('eu', 'GET', `backups/${B1}`), { id: B1, project: 'shop', status: 'succeeded' });
    failures.set(key('us', 'GET', 'resources/Deployment/web'), new FleetClusterError('not found', 404));

    const created = await service.createRestore(caller, {
      kind: 'cross-cluster-restore',
      sourceClusterId: SRC,
      targetClusterId: DST,
      backups: [{ backupId: B1, volume: 'data' }],
      target: { project: 'shop', deployment: 'web' },
    });

    await service.runStep(created.id);
    expect(store.get(created.id)).toMatchObject({ status: 'failed', error: 'the target deployment does not exist' });
    expect(calls.some((c) => c.path.endsWith('/archive'))).toBe(false);
  });

  it('leaves the plan waiting in the target cluster without apply', async () => {
    const { service, store, calls, responses, key } = setup();

    responses.set(key('eu', 'GET', `backups/${B1}`), { id: B1, project: 'shop', status: 'succeeded' });
    responses.set(key('us', 'POST', 'backups/imports'), { id: 'imported-1' });
    responses.set(key('us', 'POST', 'plans'), { id: 'plan-1', status: 'pending' });
    responses.set(key('us', 'GET', 'plans/plan-1'), { status: 'pending' });

    const created = await service.createRestore(caller, {
      kind: 'cross-cluster-restore',
      sourceClusterId: SRC,
      targetClusterId: DST,
      backups: [{ backupId: B1, volume: 'data' }],
      target: { project: 'shop', deployment: 'web' },
    });

    for (let i = 0; i < 4; i++) await service.runStep(created.id);

    expect(store.get(created.id)?.status).toBe('waiting');
    expect(calls.some((c) => c.path.endsWith('/apply'))).toBe(false);
  });
});

describe('final backup (section 4)', () => {
  it('runs platform backups, every volume, waits and copies; disabled components are skipped', async () => {
    const { service, store, responses, failures, key } = setup();
    const target = cluster(DST, 'us');

    failures.set(key('us', 'POST', 'backups/platform/opensearch/run'), new FleetClusterError('not enabled', 400));
    responses.set(key('us', 'POST', 'backups/now/all'), { started: ['shop/web/data'], skipped: [] });
    responses.set(key('us', 'GET', 'backups'), []);

    const op = await service.startFinalBackup(null, target as never, new Date(0));

    for (let i = 0; i < 5; i++) await service.runStep(op.id);
    expect(store.get(op.id)?.status).toBe('waiting');

    const started = store.get(op.id)?.createdAt.toISOString();

    responses.set(key('us', 'GET', 'backups'), [
      { resource: 'shop/web/data', status: 'succeeded', startedAt: started },
    ]);
    await service.runStep(op.id);
    await service.runStep(op.id);

    const done = store.get(op.id) as FleetOperationEntity;

    expect(done.steps.map((s) => [s.key, s.status])).toEqual([
      ['platform-postgres', 'succeeded'],
      ['platform-opensearch', 'skipped'],
      ['platform-etcd', 'succeeded'],
      ['volumes', 'succeeded'],
      ['volumes-wait', 'succeeded'],
      ['copies', 'succeeded'],
    ]);
    expect(done.status).toBe('succeeded');
  });

  it('reuses the final backup of the current teardown whatever its outcome; a later teardown starts a new one', async () => {
    const { service, store, failures, key } = setup();
    const target = cluster(DST, 'us');

    for (const kind of ['postgres', 'opensearch', 'etcd'])
      failures.set(
        key('us', 'POST', `backups/platform/${kind}/run`),
        new FleetClusterError('no control-plane member can hold a master-key share yet', 503),
      );

    const teardownStart = new Date();
    const op = await service.startFinalBackup(null, target as never, teardownStart);

    for (let i = 0; i < 6; i++) await service.runStep(op.id);
    expect(store.get(op.id)?.status).toBe('failed');

    // Decabill repeats the teardown call (since = epoch): the failed operation is returned, nothing new starts.
    const latest = (where: { kind?: string }) => (where.kind === 'final-backup' ? (store.get(op.id) ?? null) : null);
    const operations = (service as unknown as { operations: { findOne: jest.Mock } }).operations;

    operations.findOne.mockImplementation(async ({ where }: { where: { id?: string; kind?: string } }) =>
      where.id ? (store.get(where.id) ?? null) : latest(where),
    );
    expect((await service.startFinalBackup(null, target as never, new Date(0))).id).toBe(op.id);
    expect(operations.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'final-backup', targetClusterId: DST } }),
    );

    // A new teardown (entered again after a resume) starts after the old operation: a new one.
    const save = (service as unknown as { operations: { save: jest.Mock } }).operations.save;
    const saves = save.mock.calls.length;

    await service.startFinalBackup(null, target as never, new Date(Date.now() + 60_000));
    expect(save.mock.calls.length).toBeGreaterThan(saves);
  });
});
