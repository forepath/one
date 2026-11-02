import {
  buildPackageArchive,
  generateSigningKeyPair,
  parseAppStoreConfig,
  sha256Digest,
  signBlob,
  verifyIndex,
  verifyPackage,
} from '@forepath/loadweaver/shared/util-app-catalog';

import {
  appStoreUnchanged,
  archiveMinLoadweaver,
  buildFleetIndex,
  clusterAppStoreDocument,
  fleetCatalogIdentity,
  fixedFleetCatalog,
  mergeAppStoreSettings,
  MIN_LOADWEAVER_NONE,
  normalizeFleetUrl,
  packageSummary,
  parsePackageFile,
  pickChannel,
  serializeIndex,
  validateUpload,
  type CatalogSettingsParams,
} from './fleet-catalog.utils';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function manifest(version = '1.2.0', extra = ''): string {
  return `apiVersion: apps.loadweaver.com/v1
name: wiki
version: ${version}
title: Wiki
description: |
  A small wiki.

  Longer text.
publisher: acme
license: MIT
homepage: https://example.com/wiki
docs: https://example.com/wiki/docs
channels: [stable, beta]
${extra}`;
}

function archive(options: { version?: string; compose?: string; extra?: string } = {}): Buffer {
  return buildPackageArchive({
    readme: '# Wiki\n',
    compose: options.compose ?? `services:\n  web:\n    image: ghcr.io/acme/wiki@${DIGEST}\n`,
    manifest: manifest(options.version, options.extra),
  });
}

const params = (patch: Partial<CatalogSettingsParams> = {}): CatalogSettingsParams => ({
  fleetCatalog: null,
  catalogs: [],
  enable: [],
  disable: [],
  replaceCatalogs: false,
  allowedTrust: null,
  apply: false,
  ...patch,
});

describe('fleet catalog utils', () => {
  it('reads the catalog identity from the environment with safe defaults', () => {
    expect(fleetCatalogIdentity({})).toEqual({ name: 'fleet', title: 'Fleet catalog', publisher: 'fleet' });
    expect(
      fleetCatalogIdentity({
        FLEET_CATALOG_NAME: 'acme',
        FLEET_CATALOG_TITLE: 'Acme',
        FLEET_CATALOG_PUBLISHER: 'Acme',
      }),
    ).toEqual({ name: 'acme', title: 'Acme', publisher: 'Acme' });
    expect(fleetCatalogIdentity({ FLEET_CATALOG_NAME: 'Not A Label' }).name).toBe('fleet');
  });

  it('normalizes the fleet URL', () => {
    expect(normalizeFleetUrl('https://fleet.example.com/')).toBe('https://fleet.example.com');
    expect(normalizeFleetUrl('https://example.com/fleet/')).toBe('https://example.com/fleet');
    expect(normalizeFleetUrl('https://u:p@fleet.example.com')).toBeNull();
    expect(normalizeFleetUrl('ftp://fleet.example.com')).toBeNull();
    expect(normalizeFleetUrl('https://fleet.example.com/?x=1')).toBeNull();
    expect(normalizeFleetUrl('')).toBeNull();
  });

  describe('validateUpload', () => {
    it('accepts a valid package', () => {
      const result = validateUpload(archive());

      expect(result.ok).toBe(true);
      expect(result.ok === true && result.manifest.name).toBe('wiki');
      expect(result.ok === true && result.digest).toBe(sha256Digest(archive()));
    });

    it('refuses packages with lint errors and returns the findings', () => {
      const result = validateUpload(
        archive({ compose: `services:\n  web:\n    image: ghcr.io/acme/wiki@${DIGEST}\n    privileged: true\n` }),
      );

      expect(result.ok).toBe(false);
      expect(result.findings.some((f) => f.severity === 'error')).toBe(true);
    });

    it('refuses something that is no package', () => {
      const result = validateUpload(Buffer.from('not a tarball'));

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.errors[0]).toMatch(/gzip/);
    });
  });

  it("reads a stored archive's minLoadweaver for the backfill: the value, none, or an error", () => {
    expect(archiveMinLoadweaver(archive({ extra: 'minLoadweaver: 4.2.0\n' }))).toEqual({ ok: true, value: '4.2.0' });
    expect(archiveMinLoadweaver(archive())).toEqual({ ok: true, value: MIN_LOADWEAVER_NONE });
    expect(archiveMinLoadweaver(Buffer.from('not a tarball')).ok).toBe(false);
    expect(archiveMinLoadweaver(Buffer.alloc(0)).ok).toBe(false);
  });

  it('picks the channel', () => {
    expect(pickChannel({ channels: ['beta', 'stable'] })).toEqual({ ok: true, value: 'stable' });
    expect(pickChannel({ channels: ['beta'] })).toEqual({ ok: true, value: 'beta' });
    expect(pickChannel({ channels: ['stable', 'beta'] }, 'beta')).toEqual({ ok: true, value: 'beta' });
    expect(pickChannel({ channels: ['stable'] }, 'edge').ok).toBe(false);
  });

  it('summarizes descriptions and parses package file names', () => {
    expect(packageSummary('A small\nwiki.\n\nMore.')).toBe('A small wiki.');
    expect(packageSummary('x'.repeat(600))).toHaveLength(500);
    expect(parsePackageFile('1.2.0.tar.gz')).toEqual({ version: '1.2.0', signature: false });
    expect(parsePackageFile('1.2.0-rc.1.tar.gz.sig')).toEqual({ version: '1.2.0-rc.1', signature: true });
    expect(parsePackageFile('latest.tar.gz')).toBeNull();
    expect(parsePackageFile('1.2.0.zip')).toBeNull();
  });

  describe('buildFleetIndex', () => {
    it('builds an index that verifies with the catalog key and lists the fleet as the publisher', () => {
      const key = generateSigningKeyPair('ecdsa-p256');
      const v1 = archive({ version: '1.0.0' });
      const v2 = archive({ version: '1.2.0' });
      const index = buildFleetIndex({
        catalog: { name: 'fleet', title: 'Fleet catalog', publisher: 'fleet' },
        keys: [{ kid: key.keyId, publicKey: key.publicKeyPem }],
        packages: [
          {
            app: 'wiki',
            version: '1.0.0',
            channel: 'stable',
            title: 'Old',
            summary: 'old',
            digest: sha256Digest(v1),
            publishedAt: new Date('2026-10-01T00:00:00Z'),
            createdAt: new Date('2026-09-30T00:00:00Z'),
          },
          {
            app: 'wiki',
            version: '1.2.0',
            channel: 'stable',
            title: 'Wiki',
            summary: 'A small wiki.',
            digest: sha256Digest(v2),
            minLoadweaver: '1.4.0',
            publishedAt: null,
            createdAt: new Date('2026-10-30T00:00:00Z'),
          },
        ],
        takedowns: [{ app: 'wiki', versions: ['1.0.0'], reason: 'CVE', createdAt: new Date('2026-10-31T00:00:00Z') }],
        now: new Date('2026-10-31T12:00:00Z'),
      });

      expect(index.apps[0]).toMatchObject({ name: 'wiki', title: 'Wiki', publisher: 'fleet', trust: 'verified' });
      expect(index.apps[0].versions.map((v) => v.version)).toEqual(['1.2.0', '1.0.0']);
      expect(index.apps[0].versions[1].published).toBe('2026-10-01T00:00:00.000Z');
      // The manifest's minLoadweaver goes into the index (older rows have none).
      expect(index.apps[0].versions.map((v) => v.minLoadweaver)).toEqual(['1.4.0', undefined]);
      expect(index.takedowns).toEqual([
        { app: 'wiki', versions: ['1.0.0'], reason: 'CVE', at: '2026-10-31T00:00:00.000Z' },
      ]);

      const bytes = Buffer.from(serializeIndex(index), 'utf8');
      const verified = verifyIndex(bytes, { kind: 'blob', signature: signBlob(bytes, key.privateKeyPem) }, [
        key.publicKeyPem,
      ]);

      expect(verified.ok).toBe(true);

      const parsed = verified.ok === true ? verified.value.index : index;
      const pkg = verifyPackage({
        index: parsed,
        app: 'wiki',
        version: '1.2.0',
        archive: v2,
        signature: { kind: 'blob', signature: signBlob(v2, key.privateKeyPem) },
      });

      expect(pkg.ok).toBe(true);

      const other = generateSigningKeyPair('ecdsa-p256');

      expect(
        verifyIndex(bytes, { kind: 'blob', signature: signBlob(bytes, other.privateKeyPem) }, [key.publicKeyPem]).ok,
      ).toBe(false);
    });

    it('builds an empty index', () => {
      const key = generateSigningKeyPair('ed25519');
      const index = buildFleetIndex({
        catalog: fleetCatalogIdentity({}),
        keys: [{ kid: key.keyId, publicKey: key.publicKeyPem }],
        packages: [],
        takedowns: [],
      });

      expect(index.apps).toEqual([]);
      expect(Object.keys(index.publishers)).toEqual([key.keyId]);
    });
  });

  describe('mergeAppStoreSettings', () => {
    const key = generateSigningKeyPair('ecdsa-p256').publicKeyPem;
    const fleetCatalog = { name: 'fleet', url: 'https://fleet.example.com', publicKeys: [key], enabled: true };
    const current = {
      catalogs: [
        { name: 'official', type: 'git', url: 'https://github.com/forepath/catalog', official: true, enabled: false },
        { name: 'private', type: 'git', url: 'https://git.example.com/apps', publicKeys: [key], enabled: true },
      ],
      allowedTrust: ['official', 'verified'],
    };

    it('adds the fleet catalog and keeps the other catalogs', () => {
      const result = mergeAppStoreSettings(current, params({ fleetCatalog }));

      expect(result.ok).toBe(true);

      const value = result.ok === true ? result.value : null;

      expect(value?.appStore.catalogs.map((c) => c.name)).toEqual(['official', 'private', 'fleet']);
      expect(value?.appStore.catalogs[2]).toMatchObject({
        type: 'fleet',
        url: 'https://fleet.example.com',
        enabled: true,
      });
      expect(value?.appStore.allowedTrust).toEqual(['official', 'verified']);
    });

    it('replaces catalogs, toggles by name, sets allowedTrust and reports missing names', () => {
      const result = mergeAppStoreSettings(
        current,
        params({
          fleetCatalog,
          replaceCatalogs: true,
          enable: ['official', 'nope'],
          allowedTrust: ['official', 'verified', 'community'],
        }),
      );
      const value = result.ok === true ? result.value : null;

      expect(value?.appStore.catalogs.map((c) => [c.name, c.enabled])).toEqual([
        ['official', true],
        ['fleet', true],
      ]);
      expect(value?.appStore.allowedTrust).toEqual(['official', 'verified', 'community']);
      expect(value?.missing).toEqual(['nope']);
    });

    it('starts from the defaults when the cluster has no appStore and refuses invalid catalogs', () => {
      expect(mergeAppStoreSettings(undefined, params({ fleetCatalog })).ok).toBe(true);
      expect(
        mergeAppStoreSettings(
          undefined,
          params({ catalogs: [{ name: 'bad', type: 'git', url: 'https://git.example.com/x', enabled: true }] }),
        ).ok,
      ).toBe(false);
    });

    it('updates a stored entry for the fleet URL in place (its name stays: installs reference it)', () => {
      const own = { name: 'ours', type: 'fleet', url: 'https://fleet.example.com/', enabled: false };
      const result = mergeAppStoreSettings({ catalogs: [own] }, params({ fleetCatalog }));
      const value = result.ok === true ? result.value : null;

      expect(value?.appStore.catalogs).toEqual([{ ...fleetCatalog, name: 'ours', type: 'fleet' }]);
    });

    it('leaves the fixed entry of a cluster that trusts the fleet alone (2026-11-01)', () => {
      const fixed = { name: 'acme-fleet', url: 'https://fleet.example.com' };

      // Not stored: the cluster derives it; nothing is added under another name, toggles of it are left out.
      let result = mergeAppStoreSettings(
        current,
        params({ fleetCatalog: { ...fleetCatalog, enabled: false }, disable: ['acme-fleet'], enable: ['official'] }),
        fixed,
      );
      let value = result.ok === true ? result.value : null;

      expect(value?.appStore.catalogs.map((c) => [c.name, c.enabled])).toEqual([
        ['official', true],
        ['private', true],
      ]);
      expect(value?.fixedToggles).toEqual(['acme-fleet']);
      expect(value?.missing).toEqual([]);

      // Stored under its own name: updated in place (kept enabled) and kept by replaceCatalogs.
      const stored = { ...current, catalogs: [...current.catalogs, { name: 'fleet', type: 'fleet', url: fixed.url }] };

      result = mergeAppStoreSettings(
        stored,
        params({ fleetCatalog: { ...fleetCatalog, enabled: false }, replaceCatalogs: true, disable: ['fleet'] }),
        { ...fixed, name: 'fleet' },
      );
      value = result.ok === true ? result.value : null;
      expect(value?.appStore.catalogs.map((c) => [c.name, c.enabled])).toEqual([
        ['official', false],
        ['fleet', true],
      ]);
      expect(value?.fixedToggles).toEqual(['fleet']);

      result = mergeAppStoreSettings(stored, params({ replaceCatalogs: true }), { ...fixed, name: 'fleet' });
      expect(result.ok === true && result.value.appStore.catalogs.map((c) => c.name)).toEqual(['official', 'fleet']);
    });

    it('finds the fixed entry of this fleet in a cluster’s catalog list', () => {
      const list = {
        catalogs: [
          { name: 'other', url: 'https://other.example.com/', fleetManaged: true },
          { name: 'acme-fleet', url: 'https://fleet.example.com/', fleetManaged: true },
        ],
      };

      expect(fixedFleetCatalog(list, 'https://fleet.example.com')).toEqual({
        name: 'acme-fleet',
        url: 'https://fleet.example.com',
      });
      expect(
        fixedFleetCatalog(
          { catalogs: [{ name: 'f', url: 'https://fleet.example.com/' }] },
          'https://fleet.example.com',
        ),
      ).toBeNull();
      expect(fixedFleetCatalog(list, null)).toBeNull();
      expect(fixedFleetCatalog({}, 'https://fleet.example.com')).toBeNull();
      expect(fixedFleetCatalog(null, 'https://fleet.example.com')).toBeNull();
    });

    it('detects unchanged settings', () => {
      const merged = mergeAppStoreSettings(current, params({ fleetCatalog }));
      const next = merged.ok === true ? merged.value.appStore : null;

      expect(appStoreUnchanged(next, next as never)).toBe(true);
      expect(appStoreUnchanged(current, next as never)).toBe(false);
      expect(appStoreUnchanged(undefined, next as never)).toBe(false);
    });
  });

  it('builds the Cluster document with the new appStore', () => {
    const appStore = parseAppStoreConfig({});
    const doc = clusterAppStoreDocument(
      {
        apiVersion: 'loadweaver.com/v1',
        kind: 'Cluster',
        metadata: { name: 'prod', labels: { env: 'prod' }, project: undefined },
        spec: { failureDomain: 'node' },
      },
      appStore.ok === true ? appStore.value : (null as never),
    );

    expect(doc).toEqual({
      apiVersion: 'loadweaver.com/v1',
      kind: 'Cluster',
      metadata: { name: 'prod', labels: { env: 'prod' } },
      spec: { failureDomain: 'node', appStore: { catalogs: [], allowedTrust: ['official', 'verified'] } },
    });
    expect(() =>
      clusterAppStoreDocument({ kind: 'Deployment', metadata: { name: 'x' }, spec: {} }, null as never),
    ).toThrow();
  });
});
