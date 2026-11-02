import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  buildPackageArchive,
  generateSigningKeyPair,
  hasLintErrors,
  publicKeyId,
  verifyBlob,
} from '@forepath/loadweaver/shared/util-app-catalog';

import { asSigningKey } from './__fixtures__/catalog-fixture';
import { buildCatalogIndex, loadCatalog } from './catalog';
import { validatePackage } from './package-dir';

/** The committed catalogs (apps/loadweaver/app-catalog): every package must lint and validate clean. */
const CATALOGS = join(__dirname, '..', '..', '..', '..', 'app-catalog');

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }

  return out;
}

describe('app catalog content (apps/loadweaver/app-catalog)', () => {
  it.each(['official', 'community'])('%s: every package lints and validates without errors', async (name) => {
    const catalog = await loadCatalog(join(CATALOGS, name));

    expect(catalog.errors).toEqual([]);
    expect(catalog.packages.length).toBeGreaterThan(0);

    for (const pkg of catalog.packages) {
      const where = `${name}/${pkg.app}/${pkg.version}`;

      expect({ where, lint: hasLintErrors(pkg.findings) ? pkg.findings : [] }).toEqual({ where, lint: [] });
      expect({ where, errors: validatePackage(pkg.files).errors }).toEqual({ where, errors: [] });
    }
  });

  it('ships Agenstra (controller, manager) and Decabill in the official catalog', async () => {
    const catalog = await loadCatalog(join(CATALOGS, 'official'));

    expect(catalog.packages.map((p) => p.app).sort()).toEqual(
      expect.arrayContaining(['agenstra-controller', 'agenstra-manager', 'decabill-billing']),
    );

    for (const pkg of catalog.packages) {
      expect(pkg.manifest?.publisher).toBe('ForePath');
      // ForePath images use the package's release tag (same release as the other deployment variants).
      for (const match of pkg.files.compose.matchAll(/ghcr\.io\/forepath\/[a-z0-9-]+:([^@\s]+)@sha256:/g))
        expect({ app: pkg.app, tag: match[1] }).toEqual({ app: pkg.app, tag: pkg.version });
    }
  });

  it('community: every package carries a valid signature of its publisher', async () => {
    const catalog = await loadCatalog(join(CATALOGS, 'community'));

    for (const pkg of catalog.packages) {
      const keys = Object.values(catalog.publishers)
        .filter((p) => p.name === pkg.manifest?.publisher)
        .map((p) => p.publicKey);

      expect(pkg.signature).toBeDefined();
      expect(verifyBlob(buildPackageArchive(pkg.files), pkg.signature as string, keys).ok).toBe(true);
    }
  });

  it('official: the index builds with the catalog key (a throwaway key stands in for it here)', async () => {
    const catalog = await loadCatalog(join(CATALOGS, 'official'));
    const stand = generateSigningKeyPair();
    const forepath = Object.entries(catalog.publishers).find(([, p]) => p.name === 'ForePath');

    expect(forepath).toBeDefined();
    expect(catalog.catalogKeys.map((k) => publicKeyId(k))).toContain(forepath?.[0]);

    // Swap the committed (development) public key for the throwaway one: same structure, no private key needed.
    const swapped = {
      ...catalog,
      catalogKeys: [stand.publicKeyPem],
      publishers: {
        [stand.keyId]: { ...(forepath?.[1] as (typeof catalog.publishers)[string]), publicKey: stand.publicKeyPem },
      },
    };
    const built = buildCatalogIndex(swapped, { catalogKey: asSigningKey(stand) });

    expect(built.index.apps.every((a) => a.trust === 'official')).toBe(true);
    expect(built.index.apps.flatMap((a) => a.versions.map((v) => v.published))).not.toContain(undefined);
  });

  it('contains no private key and marks the committed keys as development keys', async () => {
    for (const file of await files(CATALOGS)) {
      const text = await readFile(file, 'utf8');

      expect({ file: relative(CATALOGS, file), privateKey: /PRIVATE KEY-----/.test(text) }).toEqual({
        file: relative(CATALOGS, file),
        privateKey: false,
      });
    }

    for (const name of ['official', 'community']) {
      const keys = (await readdir(join(CATALOGS, name, 'keys'))).filter((f) => f.endsWith('.pub'));

      expect(keys.length).toBeGreaterThan(0);
      keys.forEach((k) => expect(k).toMatch(/\.dev\.pub$/));
      expect((await stat(join(CATALOGS, name, 'keys', 'README.md'))).isFile()).toBe(true);
    }
  });
});
