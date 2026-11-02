import { generateSigningKeyPair } from '@forepath/loadweaver/shared/util-app-catalog';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { FleetOperationEntity } from '../entities/fleet-operation.entity';
import { clusterAccess, type FleetCaller } from '../utils/fleet-access.utils';
import { FleetOperationsService } from './fleet-operations.service';

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const admin: FleetCaller = { userId: 'u1', isApiKey: false, isAdmin: true, label: 'fleet:admin' };
const user: FleetCaller = { userId: 'u2', isApiKey: false, isAdmin: false, label: 'fleet:bob' };
const KEY = generateSigningKeyPair('ecdsa-p256').publicKeyPem;

const cluster = (id: string, name: string, state = 'active') => ({
  id,
  name,
  state,
  readOnlyUntil: null,
  endpoint: `https://${name}.example.com`,
  credential: 'pat',
  caCertificate: null,
  updatedAt: new Date(),
  health: { state: 'healthy' },
});

function setup(
  options: { clusterResource?: Record<string, unknown> | null; planStatus?: string; catalogs?: unknown | Error } = {},
) {
  const store = new Map<string, FleetOperationEntity>();
  let n = 0;
  const clusters: Record<string, ReturnType<typeof cluster>> = { [C1]: cluster(C1, 'eu'), [C2]: cluster(C2, 'us') };
  const operations = {
    create: (v: Partial<FleetOperationEntity>) => v,
    save: jest.fn(async (v: FleetOperationEntity) => {
      const row = {
        id: v.id ?? `abcdef12-0000-4000-8000-${String(++n).padStart(12, '0')}`,
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
  const access = {
    assertAdmin: jest.fn((c: FleetCaller) => {
      if (!c.isAdmin) throw new ForbiddenException('fleet admins only');
    }),
    visibleCluster: jest.fn(async (c: FleetCaller, id: string) => ({
      cluster: clusters[id],
      access: clusterAccess(c, [], clusters[id] as never),
    })),
  };
  const resource =
    options.clusterResource === undefined
      ? {
          apiVersion: 'loadweaver.com/v1',
          kind: 'Cluster',
          metadata: { name: 'prod' },
          spec: { failureDomain: 'node' },
        }
      : options.clusterResource;
  const calls: { cluster: string; method: string; path: string; body?: unknown; query?: unknown }[] = [];
  const client = {
    json: jest.fn(async (c: { name: string }, r: { method: string; path: string; body?: unknown; query?: unknown }) => {
      calls.push({ cluster: c.name, ...r });

      if (r.method === 'GET' && r.path === 'resources') return { data: resource ? [resource] : [], headers: {} };

      if (r.method === 'GET' && r.path === 'apps/catalogs') {
        if (options.catalogs instanceof Error) throw options.catalogs;

        return { data: options.catalogs ?? {}, headers: {} };
      }

      if (r.method === 'POST' && r.path === 'plans') return { data: { id: 'plan-1', status: 'draft' }, headers: {} };

      if (r.path === 'plans/plan-1/apply') return { data: { status: options.planStatus ?? 'applied' }, headers: {} };

      if (r.path === 'plans/plan-1') return { data: { status: options.planStatus ?? 'approved' }, headers: {} };

      return { data: {}, headers: {} };
    }),
  };
  const audit = { record: jest.fn(async () => undefined), recordQuietly: jest.fn(async () => undefined) };
  const catalog = { publicKey: jest.fn(async () => KEY) };
  const service = new FleetOperationsService(
    operations as never,
    clusterRepo as never,
    access as never,
    client as never,
    audit as never,
    undefined,
    catalog as never,
  );

  return { service, store, calls, clusters, audit };
}

describe('FleetOperationsService: apply catalog settings', () => {
  const env = process.env['FLEET_PUBLIC_URL'];

  afterEach(() => {
    if (env === undefined) delete process.env['FLEET_PUBLIC_URL'];
    else process.env['FLEET_PUBLIC_URL'] = env;
  });

  it('creates one operation per cluster with the fleet catalog (URL + key) and audits each', async () => {
    process.env['FLEET_PUBLIC_URL'] = 'https://fleet.example.com/';

    const { service, audit } = setup();
    const ops = await service.createCatalogSettings(admin, {
      clusterIds: [C1, C2, C1],
      allowedTrust: ['official', 'verified'],
      apply: true,
    });

    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.targetClusterId)).toEqual([C1, C2]);
    expect(ops[0]).toMatchObject({ kind: 'catalog-settings', status: 'running', sourceClusterId: null });
    expect(ops[0].steps.map((s) => s.key)).toEqual(['catalog-plan', 'catalog-apply']);
    expect(ops[0].params).toMatchObject({
      fleetCatalog: { name: 'fleet', url: 'https://fleet.example.com', publicKeys: [KEY], enabled: true },
      allowedTrust: ['official', 'verified'],
      apply: true,
    });
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('uses the console-sent fleet URL without FLEET_PUBLIC_URL and refuses without any', async () => {
    delete process.env['FLEET_PUBLIC_URL'];

    const { service } = setup();
    const [op] = await service.createCatalogSettings(admin, { clusterIds: [C1], fleetUrl: 'https://fleet.local' });

    expect((op.params['fleetCatalog'] as { url: string }).url).toBe('https://fleet.local');
    await expect(service.createCatalogSettings(admin, { clusterIds: [C1] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('is for fleet admins, needs something to apply, valid catalogs and active clusters', async () => {
    process.env['FLEET_PUBLIC_URL'] = 'https://fleet.example.com';

    const { service, clusters } = setup();

    await expect(service.createCatalogSettings(user, { clusterIds: [C1] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createCatalogSettings(admin, { clusterIds: [C1], includeFleetCatalog: false }),
    ).rejects.toThrow('nothing to apply');
    await expect(
      service.createCatalogSettings(admin, {
        clusterIds: [C1],
        includeFleetCatalog: false,
        catalogs: [{ name: 'priv', type: 'git', url: 'https://git.example.com/apps' }],
      }),
    ).rejects.toThrow(/public key/);
    await expect(
      service.createCatalogSettings(admin, { clusterIds: [C1], enable: ['official'], disable: ['official'] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    clusters[C2].state = 'teardown';
    await expect(service.createCatalogSettings(admin, { clusterIds: [C2] })).rejects.toThrow(/not active/);
  });

  it('plans the merged Cluster.spec.appStore and applies the plan', async () => {
    process.env['FLEET_PUBLIC_URL'] = 'https://fleet.example.com';

    const { service, store, calls } = setup();
    const [op] = await service.createCatalogSettings(admin, {
      clusterIds: [C1],
      enable: ['official', 'missing'],
      apply: true,
    });

    await service.runStep(op.id);

    const plan = calls.find((c) => c.method === 'POST' && c.path === 'plans');
    const doc = JSON.parse((plan?.body as { documents: string }).documents);

    expect(doc).toMatchObject({
      kind: 'Cluster',
      metadata: { name: 'prod' },
      spec: {
        failureDomain: 'node',
        appStore: {
          catalogs: [
            { name: 'fleet', type: 'fleet', url: 'https://fleet.example.com', publicKeys: [KEY], enabled: true },
          ],
          allowedTrust: ['official', 'verified'],
        },
      },
    });
    expect(store.get(op.id)?.steps[0]).toMatchObject({
      status: 'succeeded',
      detail: { planId: 'plan-1', missing: ['official', 'missing'] },
    });

    const done = await service.runStep(op.id);

    expect(calls.some((c) => c.path === 'plans/plan-1/apply')).toBe(true);
    expect(done?.status).toBe('succeeded');
  });

  it('skips the plan when nothing changes and waits for review without apply', async () => {
    process.env['FLEET_PUBLIC_URL'] = 'https://fleet.example.com';

    const appStore = {
      catalogs: [{ name: 'fleet', type: 'fleet', url: 'https://fleet.example.com', publicKeys: [KEY], enabled: true }],
      allowedTrust: ['official', 'verified'],
    };
    const unchanged = setup({
      clusterResource: { kind: 'Cluster', metadata: { name: 'prod' }, spec: { appStore } },
    });
    const [op] = await unchanged.service.createCatalogSettings(admin, { clusterIds: [C1] });

    await unchanged.service.runStep(op.id);

    const done = await unchanged.service.runStep(op.id);

    expect(done?.steps.map((s) => s.status)).toEqual(['succeeded', 'skipped']);
    expect(done?.status).toBe('succeeded');
    expect(unchanged.calls.some((c) => c.path === 'plans')).toBe(false);

    const review = setup();
    const [op2] = await review.service.createCatalogSettings(admin, { clusterIds: [C1], allowedTrust: ['verified'] });

    await review.service.runStep(op2.id);

    const waiting = await review.service.runStep(op2.id);

    expect(waiting?.status).toBe('waiting');
    expect(review.calls.some((c) => c.path === 'plans/plan-1/apply')).toBe(false);
  });

  it('fails the plan step when the cluster has no Cluster resource', async () => {
    process.env['FLEET_PUBLIC_URL'] = 'https://fleet.example.com';

    const { service } = setup({ clusterResource: null });
    const [op] = await service.createCatalogSettings(admin, { clusterIds: [C1] });
    const result = await service.runStep(op.id);

    expect(result?.status).toBe('failed');
    expect(result?.error).toMatch(/no Cluster resource/);
  });

  it('leaves the fixed entry of a cluster that trusts this fleet alone (no second entry, no toggles)', async () => {
    process.env['FLEET_PUBLIC_URL'] = 'https://fleet.example.com';

    const fixed = { name: 'acme-fleet', type: 'fleet', url: 'https://fleet.example.com/', fleetManaged: true };
    const { service, store, calls } = setup({
      catalogs: { catalogs: [{ name: 'official', url: 'oci://x/y', fleetManaged: false }, fixed] },
    });
    const [op] = await service.createCatalogSettings(admin, {
      clusterIds: [C1],
      fleetCatalogEnabled: false,
      disable: ['acme-fleet'],
      allowedTrust: ['official'],
      apply: true,
    });

    await service.runStep(op.id);

    const plan = calls.find((c) => c.method === 'POST' && c.path === 'plans');
    const doc = JSON.parse((plan?.body as { documents: string }).documents);

    // The cluster derives the entry from the trusted-fleet registration; writing it would only rename it.
    expect(doc.spec.appStore).toEqual({ catalogs: [], allowedTrust: ['official'] });
    expect(store.get(op.id)?.steps[0]).toMatchObject({
      status: 'succeeded',
      detail: { planId: 'plan-1', fleetManaged: 'acme-fleet', fixedToggles: ['acme-fleet'] },
    });
  });

  it('merges as before when the cluster can’t list its catalogs', async () => {
    process.env['FLEET_PUBLIC_URL'] = 'https://fleet.example.com';

    const { service, calls } = setup({ catalogs: new Error('404') });
    const [op] = await service.createCatalogSettings(admin, { clusterIds: [C1], apply: true });

    await service.runStep(op.id);

    const plan = calls.find((c) => c.method === 'POST' && c.path === 'plans');

    expect(JSON.parse((plan?.body as { documents: string }).documents).spec.appStore.catalogs).toEqual([
      { name: 'fleet', type: 'fleet', url: 'https://fleet.example.com', publicKeys: [KEY], enabled: true },
    ]);
  });
});
