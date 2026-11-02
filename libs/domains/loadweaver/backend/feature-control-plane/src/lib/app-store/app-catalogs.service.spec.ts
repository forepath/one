import { generateSigningKeyPair, signBlob, type CatalogSource } from '@forepath/loadweaver/shared/util-app-catalog';
import { appAnnotations } from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { databaseTarget } from '../database-handover/database-target.runtime';
import { ResourceEntity } from '../entities/resource.entity';
import { TrustedFleetEntity } from '../fleet-identity/fleet-identity.entities';
import { AppCatalogsService } from './app-catalogs.service';
import { AppCatalogEntity, AppPackageEntity, AppTakedownFlagEntity } from './app-store.entities';
import { blobSignature, memoryDataSource, testCatalog, type TestCatalog } from './app-store.testing';
import type { CatalogClient } from './catalog-clients';

const KEYS = new Map<unknown, string[]>([
  [AppCatalogEntity, ['name']],
  [AppPackageEntity, ['catalog', 'app', 'version']],
  [AppTakedownFlagEntity, ['project', 'deployment']],
  [ResourceEntity, ['kind', 'projectKey', 'name']],
  [TrustedFleetEntity, ['issuer']],
]);

const admin = { clusterRole: 'cluster-admin', isApiKey: false, projects: new Map() };
const member = { isApiKey: false, projects: new Map([['shop', 'developer']]) };
const nobody = { isApiKey: false, projects: new Map() };

function setup(catalog: TestCatalog, options: { enabled?: boolean; keys?: string[]; allowedTrust?: string[] } = {}) {
  const { dataSource, table } = memoryDataSource(KEYS);
  let served = catalog;
  let indexSignature: (bytes: Buffer) => { kind: 'blob'; signature: string } = (bytes) =>
    blobSignature(bytes, served.catalogKey);
  const client: CatalogClient = {
    fetchIndex: jest.fn(async () => {
      const bytes = served.indexBytes();

      return { bytes, signature: indexSignature(bytes), commit: 'c'.repeat(40) };
    }),
    fetchPackage: jest.fn(async (_s: CatalogSource, _app: string, version: string) => {
      const bytes = served.packages.get(version) as Buffer;

      return { bytes, signature: blobSignature(bytes, served.publisherKey) };
    }),
  };
  const caller = { current: admin as Record<string, unknown> };
  const access = { caller: jest.fn(async () => caller.current) };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new AppCatalogsService(
    dataSource as never,
    access as never,
    audit as never,
    {} as never,
    {} as never,
  );

  service.clients = { git: client };
  service.official = { type: 'oci', url: 'oci://ghcr.io/forepath/loadweaver-apps', publicKeys: [] };
  table(ResourceEntity).push({
    kind: 'Cluster',
    projectKey: '',
    name: 'cluster',
    spec: {
      appStore: {
        catalogs: [
          {
            name: 'acme',
            type: 'git',
            url: 'https://git.example.com/acme/apps.git',
            publicKeys: options.keys ?? [catalog.catalogKey.publicKeyPem],
            enabled: options.enabled ?? true,
          },
        ],
        ...(options.allowedTrust ? { allowedTrust: options.allowedTrust } : {}),
      },
    },
  });

  return {
    service,
    table,
    client,
    audit,
    caller,
    serve: (next: TestCatalog) => (served = next),
    signIndexWith: (fn: typeof indexSignature) => (indexSignature = fn),
  };
}

afterEach(() => databaseTarget.reset());

describe('AppCatalogsService: refresh and verification (P1)', () => {
  it('fetches, verifies and caches the index; lists the official catalog (disabled, no key configured)', async () => {
    const catalog = testCatalog();
    const { service } = setup(catalog);

    await service.refresh(undefined);

    const { catalogs, allowedTrust } = await service.catalogs(undefined);

    expect(allowedTrust).toEqual(['official', 'verified']);
    expect(catalogs.map((c) => [c.name, c.status, c.keys, c.apps])).toEqual([
      ['official', 'disabled', 'none', 0],
      ['acme', 'ok', 'configured', 1],
    ]);
    expect(catalogs[1]).toMatchObject({ title: 'Acme apps', generatedAt: '2026-10-31T00:00:00Z', error: null });
    // Git catalogs show the commit the ref resolved to (2026-11-01).
    expect(catalogs[1].resolvedCommit).toBe('c'.repeat(40));
    expect(catalogs[0].resolvedCommit).toBeNull();
  });

  it('refuses a tampered index and an index signed by another key; keeps serving the last verified one', async () => {
    const catalog = testCatalog();
    const { service, serve, signIndexWith } = setup(catalog);

    await service.refresh(undefined);

    // Tampered: the bytes change after signing.
    const tampered = testCatalog(['1.0.0', '1.2.0', '2.0.0'], { keys: catalog, generatedAt: '2026-11-01T00:00:00Z' });

    serve(tampered);
    signIndexWith(() => blobSignature(catalog.indexBytes(), catalog.catalogKey));
    await service.refresh(undefined);

    let acme = (await service.catalogs(undefined)).catalogs[1];

    expect(acme.status).toBe('error');
    expect(acme.error).toContain('verification failed');
    // A failed refresh keeps the last verified index and the commit it came from.
    expect(acme.resolvedCommit).toBe('c'.repeat(40));
    expect((await service.apps(undefined)).apps[0].versions.map((v) => v.version)).toEqual(['1.2.0', '1.0.0']);

    // Wrong key: a valid signature by a key the catalog doesn't trust.
    const stranger = generateSigningKeyPair('ecdsa-p256');

    signIndexWith((bytes) => ({ kind: 'blob', signature: signBlob(bytes, stranger.privateKeyPem) }));
    await service.refresh(undefined);
    acme = (await service.catalogs(undefined)).catalogs[1];
    expect(acme.status).toBe('error');
    expect((await service.apps(undefined)).apps).toHaveLength(1);
  });

  it('refuses an index older than the cached one (no rollback past a takedown)', async () => {
    const catalog = testCatalog();
    const { service, serve } = setup(catalog);

    await service.refresh(undefined);
    serve(testCatalog(['1.0.0'], { keys: catalog, generatedAt: '2026-10-01T00:00:00Z' }));
    await service.refresh(undefined);

    const acme = (await service.catalogs(undefined)).catalogs[1];

    expect(acme.error).toContain('older than the cached one');
    expect(acme.generatedAt).toBe('2026-10-31T00:00:00Z');
  });

  it('never serves a cache verified for another source (keys changed) and nothing without keys', async () => {
    const catalog = testCatalog();
    const { service, table } = setup(catalog);

    await service.refresh(undefined);

    const cluster = table(ResourceEntity)[0] as { spec: { appStore: { catalogs: { publicKeys: string[] }[] } } };

    cluster.spec.appStore.catalogs[0].publicKeys = [generateSigningKeyPair().publicKeyPem];
    expect((await service.catalogs(undefined)).catalogs[1].status).toBe('pending');
    expect((await service.apps(undefined)).apps).toEqual([]);
  });

  it('an enabled official catalog without the shipped key is untrusted and never fetched', async () => {
    const { service, table, client } = setup(testCatalog());
    const cluster = table(ResourceEntity)[0] as { spec: { appStore: { catalogs: unknown[] } } };

    cluster.spec.appStore.catalogs.push({
      name: 'official',
      type: 'oci',
      url: 'oci://ghcr.io/forepath/loadweaver-apps',
      official: true,
      enabled: true,
    });
    await service.refresh(undefined, 'official');

    const official = (await service.catalogs(undefined)).catalogs.find((c) => c.name === 'official');

    expect(official).toMatchObject({ status: 'untrusted', keys: 'none' });
    expect(official?.error).toContain('LOADWEAVER_APP_CATALOG_OFFICIAL_KEY');
    expect(client.fetchIndex).not.toHaveBeenCalled();
  });

  it('pauses refreshes while the database is read-only and serves the cache', async () => {
    const catalog = testCatalog();
    const { service, client } = setup(catalog);

    await service.refresh(undefined);
    databaseTarget.setFallback(true);

    await expect(service.refresh(undefined)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(client.fetchIndex).toHaveBeenCalledTimes(1);
    expect((await service.apps(undefined)).apps).toHaveLength(1);
  });

  it('roles: refresh is for cluster admins, browsing for any role', async () => {
    const { service, caller } = setup(testCatalog());

    caller.current = member;
    await expect(service.refresh(undefined)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.catalogs(undefined)).resolves.toBeTruthy();

    caller.current = nobody;
    await expect(service.apps(undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('claims due catalogs once per interval in the periodic pass (enabled and trusted only)', async () => {
    const { service, client } = setup(testCatalog());
    const now = Date.parse('2026-10-31T12:00:00Z');

    expect(await service.tick(now)).toBe(1);
    expect(await service.tick(now + 60_000)).toBe(0);
    expect(await service.tick(now + service.refreshIntervalMs())).toBe(1);
    expect(client.fetchIndex).toHaveBeenCalledTimes(2);
  });
});

describe('AppCatalogsService: browsing and packages (P1)', () => {
  it('lists apps with effective trust and installability; filters by text, catalog and trust', async () => {
    const { service } = setup(testCatalog(['1.0.0', '1.2.0'], { trust: 'official' }), { allowedTrust: ['verified'] });

    await service.refresh(undefined);

    const [wiki] = (await service.apps(undefined)).apps;

    // `official` is capped at `verified` outside the official catalog.
    expect(wiki).toMatchObject({ catalog: 'acme', name: 'wiki', trust: 'verified', installable: true });
    expect(wiki.latest.version).toBe('1.2.0');
    expect((await service.apps(undefined, { q: 'WIK' })).apps).toHaveLength(1);
    expect((await service.apps(undefined, { q: 'nope' })).apps).toHaveLength(0);
    expect((await service.apps(undefined, { trust: 'community' })).apps).toHaveLength(0);
    expect((await service.apps(undefined, { catalog: 'official' })).apps).toHaveLength(0);
  });

  it('marks apps the cluster is too old for as not installable (minLoadweaver), next to the trust check', async () => {
    const { service } = setup(testCatalog(['1.0.0', '1.2.0'], { minLoadweaver: '4.2.0' }));

    await service.refresh(undefined);
    service.loadweaverVersion = () => '4.1.0';

    // Lists read the index; the app page the signed manifest of the shown version.
    expect((await service.apps(undefined)).apps[0]).toMatchObject({
      installable: false,
      notInstallableReason: 'loadweaver-version',
      minLoadweaver: '4.2.0',
      loadweaverVersion: '4.1.0',
    });
    expect(await service.app(undefined, 'acme', 'wiki')).toMatchObject({
      installable: false,
      notInstallableReason: 'loadweaver-version',
      minLoadweaver: '4.2.0',
    });

    service.loadweaverVersion = () => '4.2.0';
    expect((await service.apps(undefined)).apps[0]).toMatchObject({ installable: true, notInstallableReason: null });

    // Development builds (unknown version) aren't blocked.
    service.loadweaverVersion = () => null;
    expect((await service.apps(undefined)).apps[0]).toMatchObject({ installable: true, loadweaverVersion: null });
  });

  it('names the trust label first when both checks fail', async () => {
    const { service } = setup(testCatalog(['1.0.0'], { minLoadweaver: '9.0.0' }), { allowedTrust: ['official'] });

    await service.refresh(undefined);
    service.loadweaverVersion = () => '4.1.0';

    expect((await service.apps(undefined)).apps[0]).toMatchObject({
      installable: false,
      notInstallableReason: 'trust',
    });
  });

  it('verifies and caches packages, refuses tampered ones', async () => {
    const catalog = testCatalog();
    const { service, client, table, serve } = setup(catalog);

    await service.refresh(undefined);

    const detail = await service.app(undefined, 'acme', 'wiki');

    expect(detail.version.version).toBe('1.2.0');
    expect(detail.manifest.title).toBe('Wiki');
    expect(detail.readme).toBe('# Wiki\n');
    expect(table(AppPackageEntity)).toHaveLength(1);

    await service.app(undefined, 'acme', 'wiki');
    expect(client.fetchPackage).toHaveBeenCalledTimes(1);

    // A package that doesn't match the index digest.
    const swapped = testCatalog(['1.0.0', '1.2.0'], { keys: catalog });

    swapped.packages.set('1.0.0', catalog.packages.get('1.2.0') as Buffer);
    serve(swapped);
    await expect(service.app(undefined, 'acme', 'wiki', '1.0.0')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hides taken-down versions and refuses them; 404 for disabled catalogs', async () => {
    const takedowns = [{ app: 'wiki', versions: ['1.2.0'], reason: 'malware', at: '2026-10-31T00:00:00Z' }];
    const { service } = setup(testCatalog(['1.0.0', '1.2.0'], { takedowns }));

    await service.refresh(undefined);
    expect((await service.apps(undefined)).apps[0].versions.map((v) => v.version)).toEqual(['1.0.0']);
    await expect(service.app(undefined, 'acme', 'wiki', '1.2.0')).rejects.toBeInstanceOf(GoneException);
    await expect(service.app(undefined, 'official', 'wiki')).rejects.toBeInstanceOf(NotFoundException);

    const disabled = setup(testCatalog(), { enabled: false });

    await expect(disabled.service.app(undefined, 'acme', 'wiki')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AppCatalogsService: takedowns (P1)', () => {
  it('flags installs hit by a takedown (audited once), clears flags once the install moved on', async () => {
    const catalog = testCatalog(['1.0.0', '1.2.0']);
    const { service, table, audit, serve } = setup(catalog);
    const deployment = (version: string) => ({
      kind: 'Deployment',
      project: 'shop',
      projectKey: 'shop',
      name: 'wiki',
      annotations: appAnnotations({
        catalog: 'acme',
        name: 'wiki',
        version,
        channel: 'stable',
        digest: `sha256:${'a'.repeat(64)}`,
      }),
      labels: {},
      spec: {},
      generation: 1,
    });

    table(ResourceEntity).push(deployment('1.0.0'));
    await service.refresh(undefined);
    expect(table(AppTakedownFlagEntity)).toHaveLength(0);

    serve(
      testCatalog(['1.0.0', '1.2.0'], {
        keys: catalog,
        generatedAt: '2026-11-01T00:00:00Z',
        takedowns: [{ app: 'wiki', versions: ['1.0.0'], reason: 'vulnerable', at: '2026-11-01T00:00:00Z' }],
      }),
    );
    await service.refresh(undefined);
    await service.refresh(undefined);

    expect(table(AppTakedownFlagEntity)).toEqual([
      expect.objectContaining({
        project: 'shop',
        deployment: 'wiki',
        app: 'wiki',
        version: '1.0.0',
        reason: 'vulnerable',
      }),
    ]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'app.takedown' }));

    // Updated to 1.2.0: the flag goes away on the next refresh.
    table(ResourceEntity).splice(1, 1, deployment('1.2.0'));
    await service.refresh(undefined);
    expect(table(AppTakedownFlagEntity)).toHaveLength(0);
  });
});

describe('AppCatalogsService: fixed catalog of a trusted fleet (2026-11-01)', () => {
  function withFleet(options: { allowedTrust?: string[] } = {}) {
    const catalog = testCatalog();
    const ctx = setup(catalog, options);

    ctx.service.clients = { git: ctx.client, fleet: ctx.client };
    ctx.table(TrustedFleetEntity).push({
      issuer: 'fleet-1',
      name: 'Acme fleet',
      keys: [],
      catalog: { url: 'https://fleet.acme.example', publicKeys: [catalog.catalogKey.publicKeyPem] },
    });

    return ctx;
  }

  it('lists the fleet catalog as a fleet-managed entry (keys from the registration) and its apps', async () => {
    const { service } = withFleet();

    await service.refresh(undefined);

    const { catalogs } = await service.catalogs(undefined);
    const managed = catalogs.find((c) => c.fleetManaged);

    expect(managed).toMatchObject({
      name: 'acme-fleet',
      type: 'fleet',
      url: 'https://fleet.acme.example/',
      enabled: true,
      keys: 'fleet',
      status: 'ok',
      fleet: { issuer: 'fleet-1', name: 'Acme fleet' },
    });
    expect(catalogs.filter((c) => !c.fleetManaged).every((c) => c.fleet === null)).toBe(true);
    expect((await service.apps(undefined, { catalog: 'acme-fleet' })).apps.map((a) => [a.name, a.installable])).toEqual(
      [['wiki', true]],
    );
  });

  it('keeps the trust-label policy: apps of the fleet catalog stay non-installable when their label is not allowed', async () => {
    const { service } = withFleet({ allowedTrust: ['official'] });

    await service.refresh(undefined);

    const apps = (await service.apps(undefined)).apps.filter((a) => a.catalog === 'acme-fleet');

    expect(apps).toEqual([expect.objectContaining({ trust: 'verified', installable: false })]);
  });

  it('disappears when the fleet is removed from the trusted fleets', async () => {
    const { service, table } = withFleet();

    await service.refresh(undefined);
    table(TrustedFleetEntity).splice(0, 1);

    const { catalogs } = await service.catalogs(undefined);

    expect(catalogs.some((c) => c.fleetManaged || c.name === 'acme-fleet')).toBe(false);
    expect((await service.apps(undefined)).apps.every((a) => a.catalog !== 'acme-fleet')).toBe(true);
  });

  it('fetches a newly registered fleet catalog on catalogSourcesChanged (no restart, no tick wait)', async () => {
    const { service } = withFleet();
    const tick = jest.spyOn(service, 'tick').mockResolvedValue(1);

    service.catalogSourcesChanged();
    expect(tick).toHaveBeenCalledTimes(1);

    // Not while the database is read-only (the next tick after the handover picks it up).
    databaseTarget.setFallback(true);
    service.catalogSourcesChanged();
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
