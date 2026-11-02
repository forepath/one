/** Test helpers: throwaway catalogs and keys in temp dirs (no key is ever committed). */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { generateSigningKeyPair, type SigningKeyPair } from '@forepath/loadweaver/shared/util-app-catalog';

import type { SigningKey } from '../keys';
import { scaffoldFiles } from '../package-dir';

export function asSigningKey(pair: SigningKeyPair): SigningKey {
  return { privateKeyPem: pair.privateKeyPem, publicKeyPem: pair.publicKeyPem, keyId: pair.keyId };
}

export interface CatalogFixture {
  dir: string;
  catalogKey: SigningKeyPair;
  publisherKey: SigningKeyPair;
}

/** A catalog with a catalog key, one publisher (own key) and the given packages (scaffolded). */
export async function writeCatalog(
  dir: string,
  options: {
    name?: string;
    trust?: 'official' | 'verified' | 'community';
    publisherLabel?: 'official' | 'verified' | 'community';
    packages?: { app: string; version: string }[];
    takedowns?: string;
    /** Register the catalog key as the publisher's key (official flow). */
    publisherUsesCatalogKey?: boolean;
  } = {},
): Promise<CatalogFixture> {
  const catalogKey = generateSigningKeyPair();
  const publisherKey = options.publisherUsesCatalogKey ? catalogKey : generateSigningKeyPair('ed25519');
  const trust = options.trust ?? 'community';

  await mkdir(join(dir, 'keys'), { recursive: true });
  await mkdir(join(dir, 'publishers'), { recursive: true });
  await writeFile(
    join(dir, 'catalog.yaml'),
    `apiVersion: apps.loadweaver.com/v1\nkind: Catalog\nname: ${options.name ?? 'test-catalog'}\ntitle: Test\ntrust: ${trust}\n`,
  );
  await writeFile(join(dir, 'keys', 'catalog.pub'), catalogKey.publicKeyPem);
  await writeFile(
    join(dir, 'publishers', 'acme.yaml'),
    `name: Acme\nlabel: ${options.publisherLabel ?? trust}\nkeys:\n  - |\n${publisherKey.publicKeyPem
      .trim()
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n')}\n`,
  );

  if (options.takedowns) await writeFile(join(dir, 'takedowns.yaml'), options.takedowns);

  for (const { app, version } of options.packages ?? [{ app: 'demo', version: '1.0.0' }]) {
    const files = scaffoldFiles(app, { version, publisher: 'Acme' });
    const pkg = join(dir, app, version);

    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'manifest.yaml'), files.manifest);
    await writeFile(join(pkg, 'compose.yaml'), files.compose);
    await writeFile(join(pkg, 'README.md'), files.readme);
  }

  return { dir, catalogKey, publisherKey };
}
