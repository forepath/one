import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildPackageArchive,
  generateSigningKeyPair,
  listedApps,
  signBlob,
  verifyIndex,
  verifyPackage,
} from '@forepath/loadweaver/shared/util-app-catalog';

import { asSigningKey, writeCatalog } from './__fixtures__/catalog-fixture';
import { buildCatalogIndex, CatalogBuildError, loadCatalog, PACKAGE_SIGNATURE_FILE } from './catalog';
import { readPackageDir } from './package-dir';

const NOW = new Date('2026-10-31T12:00:00Z');

describe('lw app: catalogs and index build', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-app-catalog-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('builds and signs the index of an official catalog (packages signed with the catalog key)', async () => {
    const fx = await writeCatalog(dir, {
      trust: 'official',
      publisherUsesCatalogKey: true,
      packages: [
        { app: 'demo', version: '1.0.0' },
        { app: 'demo', version: '1.1.0' },
        { app: 'other', version: '0.1.0' },
      ],
    });
    const catalog = await loadCatalog(dir);

    expect(catalog.errors).toEqual([]);

    const built = buildCatalogIndex(catalog, { catalogKey: asSigningKey(fx.catalogKey), now: NOW });
    const verified = verifyIndex(Buffer.from(built.indexYaml), { kind: 'blob', signature: built.indexSignature }, [
      fx.catalogKey.publicKeyPem,
    ]);

    if (!verified.ok) throw new Error(verified.errors.join('\n'));

    const index = verified.value.index;

    expect(index.catalog).toEqual({ name: 'test-catalog', title: 'Test', trust: 'official' });
    expect(index.generatedAt).toBe('2026-10-31T12:00:00Z');
    expect(index.apps.map((a) => [a.name, a.trust, a.versions.map((v) => v.version)])).toEqual([
      ['demo', 'official', ['1.1.0', '1.0.0']],
      ['other', 'official', ['0.1.0']],
    ]);

    for (const pkg of built.packages) {
      const result = verifyPackage({
        index,
        app: pkg.app,
        version: pkg.version,
        archive: pkg.archive,
        signature: { kind: 'blob', signature: pkg.signature },
      });

      expect(result.ok).toBe(true);
    }
  });

  it('builds the same archive digest every time (deterministic packages)', async () => {
    const fx = await writeCatalog(dir, { publisherUsesCatalogKey: true });
    const a = buildCatalogIndex(await loadCatalog(dir), { catalogKey: asSigningKey(fx.catalogKey), now: NOW });
    const b = buildCatalogIndex(await loadCatalog(dir), { catalogKey: asSigningKey(fx.catalogKey), now: NOW });

    expect(a.packages[0].digest).toBe(b.packages[0].digest);
    expect(a.indexYaml).toBe(b.indexYaml);
  });

  it('takes committed publisher signatures, release data and takedowns', async () => {
    const fx = await writeCatalog(dir, {
      takedowns: `takedowns:\n  - { app: demo, versions: [1.0.0], reason: broken, at: '2026-10-30T00:00:00Z' }\n`,
    });
    const pkgDir = join(dir, 'demo', '1.0.0');
    const archive = buildPackageArchive(await readPackageDir(pkgDir));

    await writeFile(join(pkgDir, PACKAGE_SIGNATURE_FILE), signBlob(archive, fx.publisherKey.privateKeyPem));
    await writeFile(join(pkgDir, 'release.yaml'), 'published: 2026-10-01T00:00:00Z\nchannel: beta\n');

    const built = buildCatalogIndex(await loadCatalog(dir), { catalogKey: asSigningKey(fx.catalogKey), now: NOW });

    expect(built.packages[0]).toMatchObject({ keyId: fx.publisherKey.keyId, channel: 'beta' });
    expect(built.index.apps[0].versions[0].published).toBe('2026-10-01T00:00:00Z');
    expect(built.index.apps[0].trust).toBe('community');
    expect(built.index.takedowns).toHaveLength(1);
    expect(listedApps(built.index)).toEqual([]);
  });

  it('refuses unsigned community packages and signatures that do not match', async () => {
    const fx = await writeCatalog(dir);
    const unsigned = await loadCatalog(dir);

    expect(() => buildCatalogIndex(unsigned, { catalogKey: asSigningKey(fx.catalogKey) })).toThrow(
      /demo\/1\.0\.0: not signed/,
    );

    const other = generateSigningKeyPair();

    await writeFile(
      join(dir, 'demo', '1.0.0', PACKAGE_SIGNATURE_FILE),
      signBlob(Buffer.from('x'), other.privateKeyPem),
    );
    await expect(
      loadCatalog(dir).then((c) => buildCatalogIndex(c, { catalogKey: asSigningKey(fx.catalogKey) })),
    ).rejects.toThrow(/does not match any trusted key/);
  });

  it('refuses a catalog key that is not in keys/', async () => {
    await writeCatalog(dir, { publisherUsesCatalogKey: true });

    const stranger = asSigningKey(generateSigningKeyPair());

    try {
      buildCatalogIndex(await loadCatalog(dir), { catalogKey: stranger });
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogBuildError);
      expect((error as CatalogBuildError).errors.join('\n')).toContain('is not in keys/');
    }
  });

  it('collects catalog problems: private keys, trust above the catalog, wrong folders, lint and names', async () => {
    const fx = await writeCatalog(dir, { publisherLabel: 'official' });

    await writeFile(join(dir, 'keys', 'leaked.pub'), fx.catalogKey.privateKeyPem);
    await writeFile(
      join(dir, 'demo', '1.0.0', 'compose.yaml'),
      'services:\n  web:\n    image: nginx:latest\n    network_mode: host\n',
    );
    const { manifest } = await readPackageDir(join(dir, 'demo', '1.0.0'));

    await writeFile(
      join(dir, 'demo', '1.0.0', 'manifest.yaml'),
      manifest.replace('name: demo', 'name: other').replace('publisher: Acme', 'publisher: Nobody'),
    );
    await writeFile(
      join(dir, 'takedowns.yaml'),
      'takedowns:\n  - { app: ghost, versions: all, reason: x, at: 2026-10-30T00:00:00Z }\n',
    );

    const catalog = await loadCatalog(dir);
    const errors = catalog.errors.join('\n');

    expect(errors).toContain('keys/leaked.pub: private keys never belong in a catalog');
    expect(errors).toContain('label official exceeds the catalog');
    expect(errors).toContain('manifest name other is not demo');
    expect(errors).toContain('publisher Nobody is not registered');
    expect(errors).toContain('policy lint failed');
    expect(errors).toContain('ghost is not in the catalog');
  });

  it('needs a catalog.yaml', async () => {
    await expect(loadCatalog(dir)).rejects.toThrow('catalog.yaml is missing');
  });
});
