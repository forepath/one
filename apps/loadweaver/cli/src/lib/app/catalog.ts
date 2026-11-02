import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import {
  APP_NAME_PATTERN,
  APP_STORE_API_VERSION,
  buildPackageArchive,
  catalogTakedownSchema,
  compareVersions,
  hasLintErrors,
  lintPackage,
  parseIndex,
  parseManifest,
  publicKeyId,
  SEMVER_PATTERN,
  sha256Digest,
  signBlob,
  signingKeyType,
  TRUST_LABELS,
  trustRank,
  verifyBlob,
  type AppManifest,
  type CatalogApp,
  type CatalogIndex,
  type CatalogPublisher,
  type CatalogTakedown,
  type LintFinding,
  type PackageFiles,
  type TrustLabel,
} from '@forepath/loadweaver/shared/util-app-catalog';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import type { SigningKey } from './keys';
import { readPackageDir } from './package-dir';

/** Blob signature of a package, committed next to its files by the publisher (`lw app sign --out`). */
export const PACKAGE_SIGNATURE_FILE = 'package.sig';
/** Optional per-version release data (`published`, `channel`). */
export const RELEASE_FILE = 'release.yaml';
/** Folders of a catalog that never hold packages. */
const RESERVED_DIRS = new Set(['keys', 'publishers', 'dist', 'node_modules', 'docs', 'templates']);

const timestampSchema = z.iso.datetime({ offset: true });

/** `catalog.yaml`: who the catalog is. */
export const catalogConfigSchema = z.strictObject({
  apiVersion: z.literal(APP_STORE_API_VERSION),
  kind: z.literal('Catalog'),
  name: z.string().regex(APP_NAME_PATTERN),
  title: z.string().min(1).max(100),
  trust: z.enum(TRUST_LABELS),
  description: z.string().max(2000).optional(),
  /** Where the publish workflow pushes the catalog (`oci://registry/repository`). */
  oci: z
    .string()
    .regex(/^oci:\/\/[^\s/]+\/\S+$/)
    .optional(),
  /** Issue form for reports / takedown requests (the console's "Report" link). */
  reportUrl: z.url({ protocol: /^https$/ }).optional(),
});
export type CatalogConfig = z.infer<typeof catalogConfigSchema>;

/** `publishers/<name>.yaml`: a publisher and its registered public keys (inline PEM or a path in the catalog). */
export const publisherFileSchema = z.strictObject({
  name: z.string().min(1).max(100),
  label: z.enum(TRUST_LABELS),
  contact: z.string().max(200).optional(),
  homepage: z.url({ protocol: /^https?$/ }).optional(),
  keys: z.array(z.string().min(1)).min(1),
});
export type PublisherFile = z.infer<typeof publisherFileSchema>;

export const takedownsFileSchema = z.strictObject({ takedowns: z.array(catalogTakedownSchema).nullish() });

export const releaseFileSchema = z.strictObject({
  published: timestampSchema,
  channel: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,31}$/)
    .optional(),
});

/** Optional `<app>/app.yaml`: catalog-level data of an app. */
export const appFileSchema = z.strictObject({
  summary: z.string().max(500).optional(),
  deprecated: z.boolean().optional(),
});

export interface CatalogPackage {
  app: string;
  version: string;
  dir: string;
  files: PackageFiles;
  manifest?: AppManifest;
  findings: LintFinding[];
  /** Committed blob signature (`package.sig`), if any. */
  signature?: string;
  release?: z.infer<typeof releaseFileSchema>;
}

export interface LoadedCatalog {
  dir: string;
  config: CatalogConfig;
  /** Catalog keys (`keys/*.pub`): they sign the index. */
  catalogKeys: string[];
  publishers: Record<string, CatalogPublisher>;
  packages: CatalogPackage[];
  apps: Record<string, z.infer<typeof appFileSchema>>;
  takedowns: CatalogTakedown[];
  errors: string[];
}

function parseYamlWith<S extends z.ZodType>(
  text: string,
  schema: S,
  what: string,
): { ok: true; value: z.infer<S> } | { ok: false; errors: string[] } {
  let raw: unknown;

  try {
    raw = parseYaml(text, { maxAliasCount: 100, uniqueKeys: true });
  } catch (error) {
    return { ok: false, errors: [`${what}: not valid YAML: ${(error as Error).message.split('\n')[0]}`] };
  }

  const parsed = schema.safeParse(raw ?? {});

  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        errors: parsed.error.issues.map((i) => `${what}: ${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`),
      };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function directories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/** A publisher key entry: inline PEM, or a path relative to the catalog (no escaping it). */
async function resolveKey(catalogDir: string, entry: string): Promise<string> {
  if (entry.includes('-----BEGIN')) return entry.trim() + '\n';

  if (isAbsolute(entry) || relative(catalogDir, join(catalogDir, entry)).startsWith('..'))
    throw new Error(`key path ${entry} must stay inside the catalog`);

  return (await readFile(join(catalogDir, entry), 'utf8')).trim() + '\n';
}

/**
 * Reads a catalog folder: `catalog.yaml`, `keys/*.pub`, `publishers/*.yaml`, `takedowns.yaml` and the packages in
 * `<app>/<version>/`. Collects every problem in `errors` instead of stopping at the first.
 */
export async function loadCatalog(dir: string): Promise<LoadedCatalog> {
  const errors: string[] = [];
  let configText: string;

  try {
    configText = await readFile(join(dir, 'catalog.yaml'), 'utf8');
  } catch {
    throw new Error(`${join(dir, 'catalog.yaml')} is missing: not a catalog folder`);
  }

  const configResult = parseYamlWith(configText, catalogConfigSchema, 'catalog.yaml');

  if (!configResult.ok) throw new Error(configResult.errors.join('\n'));

  const config = configResult.value;
  const catalogKeys: string[] = [];

  if (await exists(join(dir, 'keys'))) {
    for (const name of (await readdir(join(dir, 'keys'))).filter((n) => n.endsWith('.pub')).sort()) {
      const pem = await readFile(join(dir, 'keys', name), 'utf8');

      if (pem.includes('PRIVATE KEY')) errors.push(`keys/${name}: private keys never belong in a catalog`);
      else if (!signingKeyType(pem)) errors.push(`keys/${name}: not an ECDSA P-256 / Ed25519 public key`);
      else catalogKeys.push(pem);
    }
  }

  const publishers: Record<string, CatalogPublisher> = {};

  if (await exists(join(dir, 'publishers'))) {
    const files = (await readdir(join(dir, 'publishers'))).filter((n) => /\.ya?ml$/.test(n)).sort();

    for (const file of files) {
      const what = `publishers/${file}`;
      const parsed = parseYamlWith(await readFile(join(dir, 'publishers', file), 'utf8'), publisherFileSchema, what);

      if (!parsed.ok) {
        errors.push(...parsed.errors);
        continue;
      }

      const publisher = parsed.value;

      if (trustRank(publisher.label) < trustRank(config.trust))
        errors.push(`${what}: label ${publisher.label} exceeds the catalog's trust ${config.trust}`);

      for (const entry of publisher.keys) {
        let pem: string;

        try {
          pem = await resolveKey(dir, entry);
        } catch (error) {
          errors.push(`${what}: ${(error as Error).message}`);
          continue;
        }

        if (pem.includes('PRIVATE KEY')) {
          errors.push(`${what}: private keys never belong in a catalog`);
          continue;
        }

        if (!signingKeyType(pem)) {
          errors.push(`${what}: a key is not an ECDSA P-256 / Ed25519 PEM public key`);
          continue;
        }

        const keyId = publicKeyId(pem);

        if (publishers[keyId]) errors.push(`${what}: key ${keyId} is already registered for ${publishers[keyId].name}`);
        else publishers[keyId] = { name: publisher.name, publicKey: pem, label: publisher.label };
      }
    }
  }

  let takedowns: CatalogTakedown[] = [];

  if (await exists(join(dir, 'takedowns.yaml'))) {
    const parsed = parseYamlWith(
      await readFile(join(dir, 'takedowns.yaml'), 'utf8'),
      takedownsFileSchema,
      'takedowns.yaml',
    );

    if (parsed.ok) takedowns = parsed.value.takedowns ?? [];
    else errors.push(...parsed.errors);
  }

  const packages: CatalogPackage[] = [];
  const apps: LoadedCatalog['apps'] = {};

  for (const app of await directories(dir)) {
    if (RESERVED_DIRS.has(app)) continue;

    if (!APP_NAME_PATTERN.test(app)) {
      errors.push(`${app}/: app folders are DNS labels`);
      continue;
    }

    if (await exists(join(dir, app, 'app.yaml'))) {
      const parsed = parseYamlWith(
        await readFile(join(dir, app, 'app.yaml'), 'utf8'),
        appFileSchema,
        `${app}/app.yaml`,
      );

      if (parsed.ok) apps[app] = parsed.value;
      else errors.push(...parsed.errors);
    }

    for (const version of await directories(join(dir, app))) {
      const where = `${app}/${version}`;

      if (!SEMVER_PATTERN.test(version)) {
        errors.push(`${where}/: version folders are semantic versions`);
        continue;
      }

      const packageDir = join(dir, app, version);
      let files: PackageFiles;

      try {
        files = await readPackageDir(packageDir);
      } catch (error) {
        errors.push(`${where}: ${(error as Error).message}`);
        continue;
      }

      const manifest = parseManifest(files.manifest);
      const entry: CatalogPackage = { app, version, dir: packageDir, files, findings: [] };

      if (!manifest.ok) errors.push(...manifest.errors.map((e) => `${where}/manifest.yaml: ${e}`));
      else {
        entry.manifest = manifest.value;

        if (manifest.value.name !== app) errors.push(`${where}: manifest name ${manifest.value.name} is not ${app}`);

        if (manifest.value.version !== version)
          errors.push(`${where}: manifest version ${manifest.value.version} is not ${version}`);

        if (!Object.values(publishers).some((p) => p.name === manifest.value.publisher))
          errors.push(`${where}: publisher ${manifest.value.publisher} is not registered (publishers/)`);

        entry.findings = lintPackage({ manifest: manifest.value, compose: files.compose });

        if (hasLintErrors(entry.findings)) errors.push(`${where}: policy lint failed (lw app lint ${packageDir})`);
      }

      if (await exists(join(packageDir, PACKAGE_SIGNATURE_FILE)))
        entry.signature = (await readFile(join(packageDir, PACKAGE_SIGNATURE_FILE), 'utf8')).trim();

      if (await exists(join(packageDir, RELEASE_FILE))) {
        const parsed = parseYamlWith(
          await readFile(join(packageDir, RELEASE_FILE), 'utf8'),
          releaseFileSchema,
          `${where}/${RELEASE_FILE}`,
        );

        if (parsed.ok) entry.release = parsed.value;
        else errors.push(...parsed.errors);
      }

      packages.push(entry);
    }
  }

  for (const takedown of takedowns) {
    if (!packages.some((p) => p.app === takedown.app))
      errors.push(`takedowns.yaml: ${takedown.app} is not in the catalog`);
  }

  return { dir, config, catalogKeys, publishers, packages, apps, takedowns, errors };
}

export interface BuiltPackage {
  app: string;
  version: string;
  channel: string;
  archive: Buffer;
  digest: string;
  /** Blob signature (cosign `sign-blob` format) by a key of the package's publisher. */
  signature: string;
  keyId: string;
  published: string;
  /** The manifest's `minLoadweaver`, copied into the index version. */
  minLoadweaver?: string;
}

export interface BuiltCatalog {
  index: CatalogIndex;
  indexYaml: string;
  indexSignature: string;
  packages: BuiltPackage[];
}

export interface BuildIndexOptions {
  /** Catalog key: signs the index; must be one of `keys/*.pub`. */
  catalogKey: SigningKey;
  /** Signs packages that have no committed `package.sig` (only for its own publisher's packages). Default: catalogKey. */
  packageKey?: SigningKey;
  /** `published` of versions without a `release.yaml`, and `generatedAt`. Default: now. */
  now?: Date;
}

/** The trust label an app gets: its publisher's label, capped by the catalog's trust. */
function appTrust(catalog: CatalogConfig, publisherLabel: TrustLabel): TrustLabel {
  return trustRank(publisherLabel) < trustRank(catalog.trust) ? catalog.trust : publisherLabel;
}

function summaryOf(manifest: AppManifest, override?: string): string {
  if (override) return override;

  const first = manifest.description.split(/(?<=\.)\s/)[0].trim();

  return first.length > 500 ? `${first.slice(0, 497)}...` : first;
}

/**
 * `lw app index build`: builds every package archive (deterministic), checks / makes the publisher signatures,
 * generates `index.yaml` (apps, versions, digests, publishers, takedowns) and signs it with the catalog key.
 * Refuses a catalog with errors (lint, unregistered publishers, bad or missing signatures).
 */
export function buildCatalogIndex(catalog: LoadedCatalog, options: BuildIndexOptions): BuiltCatalog {
  const errors = [...catalog.errors];
  const now = (options.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const packageKey = options.packageKey ?? options.catalogKey;

  if (!catalog.catalogKeys.some((pem) => publicKeyId(pem) === options.catalogKey.keyId))
    errors.push(`the catalog key ${options.catalogKey.keyId} is not in keys/ of ${catalog.config.name}`);

  const built: BuiltPackage[] = [];

  for (const pkg of catalog.packages) {
    if (!pkg.manifest) continue;

    const where = `${pkg.app}/${pkg.version}`;
    const publisherKeys = Object.entries(catalog.publishers).filter(([, p]) => p.name === pkg.manifest?.publisher);
    const archive = buildPackageArchive(pkg.files);
    const digest = sha256Digest(archive);
    let signature = pkg.signature;
    let keyId: string | undefined;

    if (signature) {
      const verified = verifyBlob(
        archive,
        signature,
        publisherKeys.map(([, p]) => p.publicKey),
      );

      if (!verified.ok) {
        errors.push(
          `${where}/${PACKAGE_SIGNATURE_FILE}: ${verified.errors.join('; ')} (the archive is ${digest}; ` +
            `re-run lw app package + lw app sign after every change)`,
        );
        continue;
      }

      keyId = verified.value.keyId;
    } else if (publisherKeys.some(([id]) => id === packageKey.keyId)) {
      signature = signBlob(archive, packageKey.privateKeyPem, packageKey.passphrase);
      keyId = packageKey.keyId;
    } else {
      errors.push(
        `${where}: not signed: commit ${PACKAGE_SIGNATURE_FILE} (lw app sign) made with a key of ${pkg.manifest.publisher}`,
      );
      continue;
    }

    built.push({
      app: pkg.app,
      version: pkg.version,
      channel: pkg.release?.channel ?? pkg.manifest.channels[0],
      archive,
      digest,
      signature,
      keyId,
      published: pkg.release?.published ?? now,
      ...(pkg.manifest.minLoadweaver ? { minLoadweaver: pkg.manifest.minLoadweaver } : {}),
    });
  }

  if (errors.length > 0) throw new CatalogBuildError(errors);

  const apps: CatalogApp[] = [];

  for (const name of [...new Set(built.map((b) => b.app))].sort()) {
    const versions = built.filter((b) => b.app === name).sort((a, b) => compareVersions(b.version, a.version));
    const latest = catalog.packages.find((p) => p.app === name && p.version === versions[0].version)
      ?.manifest as AppManifest;
    const label = catalog.publishers[versions[0].keyId].label;
    const meta = catalog.apps[name] ?? {};

    apps.push({
      name,
      title: latest.title,
      summary: summaryOf(latest, meta.summary),
      publisher: latest.publisher,
      trust: appTrust(catalog.config, label),
      versions: versions.map((v) => ({
        version: v.version,
        channel: v.channel,
        digest: v.digest,
        published: v.published,
        ...(v.minLoadweaver ? { minLoadweaver: v.minLoadweaver } : {}),
      })),
      ...(meta.deprecated ? { deprecated: true } : {}),
    });
  }

  const index = {
    apiVersion: APP_STORE_API_VERSION,
    kind: 'CatalogIndex' as const,
    catalog: { name: catalog.config.name, title: catalog.config.title, trust: catalog.config.trust },
    publishers: Object.fromEntries(Object.entries(catalog.publishers).sort(([a], [b]) => a.localeCompare(b))),
    apps,
    takedowns: catalog.takedowns,
    generatedAt: now,
  };
  const indexYaml = stringifyYaml(index, { lineWidth: 0 });
  const parsed = parseIndex(indexYaml);

  if (!parsed.ok) throw new CatalogBuildError(parsed.errors.map((e) => `index.yaml: ${e}`));

  return {
    index: parsed.value,
    indexYaml,
    indexSignature: signBlob(
      Buffer.from(indexYaml, 'utf8'),
      options.catalogKey.privateKeyPem,
      options.catalogKey.passphrase,
    ),
    packages: built,
  };
}

export class CatalogBuildError extends Error {
  constructor(readonly errors: string[]) {
    super(`the catalog has ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  }
}
