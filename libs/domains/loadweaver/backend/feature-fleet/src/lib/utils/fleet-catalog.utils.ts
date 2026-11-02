import {
  APP_NAME_PATTERN,
  APP_STORE_API_VERSION,
  compareVersions,
  hasLintErrors,
  lintPackage,
  loadPackage,
  parseAppStoreConfig,
  parseIndex,
  sameCatalogUrl,
  SEMVER_PATTERN,
  type AppManifest,
  type AppStoreConfig,
  type CatalogIndex,
  type CatalogSource,
  type LintFinding,
  type PackageFiles,
  type ParseResult,
  type TrustLabel,
} from '@forepath/loadweaver/shared/util-app-catalog';
import { stringify } from 'yaml';

/**
 * The fleet's app catalog (P1 app store, 2026-10-31): packages uploaded in the fleet console, signed with the
 * fleet's catalog key (publisher = the fleet, trust `verified` at most) and served to clusters as a `type: fleet`
 * catalog. Pure helpers: index generation, upload validation, file names and the `Cluster.spec.appStore` merge of
 * the "apply catalog settings" operation.
 */

/** Trust label of everything the fleet's catalog lists (`official` is reserved for the shipped ForePath catalog). */
export const FLEET_CATALOG_TRUST: TrustLabel = 'verified';

/** The served paths (below `/api`). Clusters with a `type: fleet` catalog append them to the catalog `url`. */
export const FLEET_CATALOG_PATHS = {
  key: '/api/catalog/key',
  index: '/api/catalog/index.yaml',
  indexSignature: '/api/catalog/index.yaml.sig',
  package: (app: string, version: string) => `/api/catalog/packages/${app}/${version}.tar.gz`,
  packageSignature: (app: string, version: string) => `/api/catalog/packages/${app}/${version}.tar.gz.sig`,
} as const;

export interface FleetCatalogIdentity {
  /** Catalog name in the index and the default name of the catalog entry in the clusters (DNS label). */
  name: string;
  title: string;
  /** Publisher name the index lists the fleet's key under (every app of this catalog has it). */
  publisher: string;
}

/** `FLEET_CATALOG_NAME` (default `fleet`), `FLEET_CATALOG_TITLE` (default "Fleet catalog"), `FLEET_CATALOG_PUBLISHER`. */
export function fleetCatalogIdentity(env: NodeJS.ProcessEnv = process.env): FleetCatalogIdentity {
  const name = env['FLEET_CATALOG_NAME']?.trim() ?? '';
  const title = env['FLEET_CATALOG_TITLE']?.trim() ?? '';
  const publisher = env['FLEET_CATALOG_PUBLISHER']?.trim() ?? '';

  return {
    name: APP_NAME_PATTERN.test(name) ? name : 'fleet',
    title: title ? title.slice(0, 100) : 'Fleet catalog',
    publisher: publisher ? publisher.slice(0, 100) : 'fleet',
  };
}

/**
 * The fleet's public base URL (`FLEET_PUBLIC_URL`, how clusters reach this fleet), normalized without a trailing
 * slash, or null when unset / not an http(s) URL without credentials.
 */
export function normalizeFleetUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();

  if (!value) return null;

  try {
    const url = new URL(value);

    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;

    if (url.search || url.hash) return null;

    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function fleetPublicUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return normalizeFleetUrl(env['FLEET_PUBLIC_URL']);
}

/**
 * Whether the catalog may go along with the fleet's registration under an http `FLEET_PUBLIC_URL`
 * (`FLEET_CATALOG_ALLOW_INSECURE_HTTP=true`, never in production; local labs without a TLS endpoint — the clusters
 * accept it only with their own `LOADWEAVER_APP_CATALOG_FLEET_ALLOW_INSECURE_HTTP`). Otherwise https only.
 */
export function fleetCatalogUrlRegistrable(url: string | null, env: NodeJS.ProcessEnv = process.env): url is string {
  if (!url) return false;

  if (url.startsWith('https://')) return true;

  return (
    url.startsWith('http://') &&
    env['FLEET_CATALOG_ALLOW_INSECURE_HTTP']?.trim().toLowerCase() === 'true' &&
    env['NODE_ENV'] !== 'production'
  );
}

// ------------------------------------------------------------------------------------------------ upload

export type UploadValidation =
  | { ok: true; files: PackageFiles; manifest: AppManifest; digest: string; findings: LintFinding[] }
  | { ok: false; errors: string[]; findings: LintFinding[] };

/** Reads, parses and lints an uploaded archive; parse errors and lint errors block it (warnings are kept). */
export function validateUpload(archive: Uint8Array): UploadValidation {
  const loaded = loadPackage(archive);

  if (loaded.ok === false) return { ok: false, errors: loaded.errors, findings: [] };

  const findings = lintPackage({ manifest: loaded.value.manifest, compose: loaded.value.files.compose });

  if (hasLintErrors(findings))
    return {
      ok: false,
      errors: findings
        .filter((f) => f.severity === 'error')
        .map((f) => (f.path ? `${f.path}: ${f.message}` : f.message)),
      findings,
    };

  return { ok: true, ...loaded.value, findings };
}

/**
 * `lw_fleet_catalog_packages.min_loadweaver` of a package whose manifest has no `minLoadweaver`: the manifest was read
 * (on upload or by the startup backfill), so NULL is left for rows uploaded before the column, not read yet.
 */
export const MIN_LOADWEAVER_NONE = '';

/**
 * The `minLoadweaver` of a stored package archive for the startup backfill: the manifest's value, or
 * `MIN_LOADWEAVER_NONE` when it has none; an error when the archive can't be read (corrupt / no longer valid).
 */
export function archiveMinLoadweaver(archive: Uint8Array): ParseResult<string> {
  let loaded: ReturnType<typeof loadPackage>;

  try {
    loaded = loadPackage(archive);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }

  if (loaded.ok === false) return loaded;

  return { ok: true, value: loaded.value.manifest.minLoadweaver ?? MIN_LOADWEAVER_NONE };
}

/** The channel a version is listed in: the requested one (must be in the manifest), else `stable` or the first. */
export function pickChannel(manifest: Pick<AppManifest, 'channels'>, requested?: string | null): ParseResult<string> {
  const wanted = requested?.trim();

  if (wanted) {
    return manifest.channels.includes(wanted)
      ? { ok: true, value: wanted }
      : {
          ok: false,
          errors: [`channel ${wanted} is not one of the manifest's channels (${manifest.channels.join(', ')})`],
        };
  }

  return { ok: true, value: manifest.channels.includes('stable') ? 'stable' : manifest.channels[0] };
}

/** The listing summary: the description's first paragraph, at most 500 characters. */
export function packageSummary(description: string): string {
  const first = description
    .trim()
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, ' ')
    .trim();

  return first.length > 500 ? `${first.slice(0, 499)}…` : first;
}

/** `<version>.tar.gz` / `<version>.tar.gz.sig` of a package URL, or null. */
export function parsePackageFile(file: string): { version: string; signature: boolean } | null {
  const match = /^(.+?)\.tar\.gz(\.sig)?$/.exec(file);

  if (!match || !SEMVER_PATTERN.test(match[1])) return null;

  return { version: match[1], signature: !!match[2] };
}

// ------------------------------------------------------------------------------------------------- index

export interface IndexPackage {
  app: string;
  version: string;
  channel: string;
  title: string;
  summary: string;
  digest: string;
  /** The package manifest's `minLoadweaver` (`''` / null: none, or not read yet; see `MIN_LOADWEAVER_NONE`). */
  minLoadweaver?: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface IndexTakedown {
  app: string;
  versions: 'all' | string[];
  reason: string;
  createdAt: Date;
}

/**
 * The catalog index of the published packages: one publisher entry per catalog key (the fleet), apps sorted by name
 * with versions newest first (title / summary of the newest), takedowns oldest first. Throws when the result does
 * not parse (it never should: the inputs were validated on upload).
 */
export function buildFleetIndex(input: {
  catalog: FleetCatalogIdentity;
  keys: readonly { kid: string; publicKey: string }[];
  packages: readonly IndexPackage[];
  takedowns: readonly IndexTakedown[];
  now?: Date;
}): CatalogIndex {
  const byApp = new Map<string, IndexPackage[]>();

  for (const p of input.packages) byApp.set(p.app, [...(byApp.get(p.app) ?? []), p]);

  const apps = [...byApp.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, versions]) => {
      const sorted = [...versions].sort((a, b) => compareVersions(b.version, a.version));

      return {
        name,
        title: sorted[0].title,
        summary: sorted[0].summary,
        publisher: input.catalog.publisher,
        trust: FLEET_CATALOG_TRUST,
        versions: sorted.map((v) => ({
          version: v.version,
          channel: v.channel,
          digest: v.digest,
          published: (v.publishedAt ?? v.createdAt).toISOString(),
          // Lists flag versions the cluster is too old for without fetching the package (as official catalogs do).
          ...(v.minLoadweaver ? { minLoadweaver: v.minLoadweaver } : {}),
        })),
      };
    });

  const index = {
    apiVersion: APP_STORE_API_VERSION,
    kind: 'CatalogIndex' as const,
    catalog: { name: input.catalog.name, title: input.catalog.title, trust: FLEET_CATALOG_TRUST },
    publishers: Object.fromEntries(
      input.keys.map((k) => [
        k.kid,
        { name: input.catalog.publisher, publicKey: k.publicKey.trim() + '\n', label: FLEET_CATALOG_TRUST },
      ]),
    ),
    apps,
    takedowns: [...input.takedowns]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((t) => ({ app: t.app, versions: t.versions, reason: t.reason, at: t.createdAt.toISOString() })),
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
  const parsed = parseIndex(index);

  if (parsed.ok === false) throw new Error(`the generated index is invalid: ${parsed.errors.join('; ')}`);

  return parsed.value;
}

/** `index.yaml` bytes of an index (block YAML, no line folding). */
export function serializeIndex(index: CatalogIndex): string {
  return stringify(index, { lineWidth: 0 });
}

// ------------------------------------------------------------------------------- apply catalog settings

/** A catalog entry the operation sets (the shared lib's `CatalogSource` input; `enabled` defaults to true here). */
export interface CatalogSettingsSource {
  name: string;
  type: CatalogSource['type'];
  url: string;
  ref?: string;
  publicKeys?: string[];
  official?: boolean;
  enabled?: boolean;
}

/** Validated input of an "apply catalog settings" operation (stored as the operation's params). */
export interface CatalogSettingsParams {
  /** This fleet's catalog (`type: fleet`, url + key of this fleet), or null to leave it as it is. */
  fleetCatalog: { name: string; url: string; publicKeys: string[]; enabled: boolean } | null;
  /** Further catalogs, upserted by name. */
  catalogs: CatalogSettingsSource[];
  /** Existing catalogs (e.g. the preconfigured `official` one) switched on / off by name. */
  enable: string[];
  disable: string[];
  /** Remove every catalog not named here (the official one stays unless it is named). */
  replaceCatalogs: boolean;
  /** `allowedTrust`, or null to keep the cluster's. */
  allowedTrust: TrustLabel[] | null;
  /** Apply the plan (the cluster's approvals still hold it); otherwise it waits in the cluster. */
  apply: boolean;
}

/**
 * This fleet's catalog as the fixed entry of a cluster that trusts this fleet (2026-11-01): the cluster derives it
 * from the trusted-fleet registration, always enabled, so the operation doesn't write or toggle it.
 */
export interface FixedFleetCatalog {
  /** The entry's name in that cluster (what its installed apps reference). */
  name: string;
  url: string;
}

/**
 * The fixed entry of this fleet's catalog in a cluster's `GET /apps/catalogs` answer (`fleetManaged` and this
 * fleet's URL), or null — also for clusters that don't mark fixed entries yet.
 */
export function fixedFleetCatalog(response: unknown, fleetUrl: string | null | undefined): FixedFleetCatalog | null {
  const catalogs = (response as { catalogs?: unknown } | null)?.catalogs;

  if (!fleetUrl || !Array.isArray(catalogs)) return null;

  const found = catalogs.find(
    (c): c is { name: string; url: string } =>
      !!c &&
      typeof c === 'object' &&
      (c as Record<string, unknown>)['fleetManaged'] === true &&
      typeof (c as Record<string, unknown>)['name'] === 'string' &&
      typeof (c as Record<string, unknown>)['url'] === 'string' &&
      sameCatalogUrl((c as { url: string }).url, fleetUrl),
  );

  return found ? { name: found.name, url: fleetUrl } : null;
}

/**
 * The cluster's new `spec.appStore`: the current one (or the defaults when there is none) with the named catalogs
 * upserted, toggles applied and `allowedTrust` replaced. `missing` = toggled names the cluster doesn't have.
 *
 * This fleet's catalog updates a stored `type: fleet` entry for its URL in place (its name stays: installed apps
 * reference it). With `fixed` (the cluster trusts this fleet and lists its catalog as a fixed entry) nothing is
 * added under another name, the stored entry survives `replaceCatalogs`, and toggles of the fixed entry are left
 * out (`fixedToggles`): the cluster keeps it enabled either way.
 */
export function mergeAppStoreSettings(
  current: unknown,
  params: CatalogSettingsParams,
  fixed: FixedFleetCatalog | null = null,
): ParseResult<{ appStore: AppStoreConfig; missing: string[]; fixedToggles: string[] }> {
  const base = parseAppStoreConfig(current ?? {});

  if (base.ok === false) return { ok: false, errors: base.errors.map((e) => `current ${e}`) };

  const fleetUrl = params.fleetCatalog?.url ?? fixed?.url;
  const storedFleet = fleetUrl
    ? base.value.catalogs.find((c) => c.type === 'fleet' && !c.official && sameCatalogUrl(c.url, fleetUrl))
    : undefined;
  const fleetEntry: Record<string, unknown>[] = !params.fleetCatalog
    ? []
    : storedFleet
      ? [{ ...params.fleetCatalog, name: storedFleet.name, type: 'fleet', ...(fixed ? { enabled: true } : {}) }]
      : fixed
        ? []
        : [{ ...params.fleetCatalog, type: 'fleet' }];
  const wanted: Record<string, unknown>[] = [
    ...params.catalogs.map((c) => ({ ...c, enabled: c.enabled ?? true })),
    ...fleetEntry,
  ];
  const names = new Set(wanted.map((c) => c['name'] as string));
  const keep = (c: AppStoreConfig['catalogs'][number]) => c.official || (!!fixed && c === storedFleet);
  let catalogs: Record<string, unknown>[] = (
    params.replaceCatalogs ? base.value.catalogs.filter(keep) : base.value.catalogs
  ).filter((c) => !names.has(c.name));

  catalogs = [...catalogs, ...wanted];

  const fixedNames = new Set(fixed ? [fixed.name, ...(storedFleet ? [storedFleet.name] : [])] : []);
  const missing: string[] = [];
  const fixedToggles: string[] = [];
  const toggle = (name: string, enabled: boolean) => {
    if (fixedNames.has(name)) {
      fixedToggles.push(name);

      return;
    }

    const found = catalogs.find((c) => c['name'] === name);

    if (found) found['enabled'] = enabled;
    else missing.push(name);
  };

  catalogs = catalogs.map((c) => ({ ...c }));
  params.enable.forEach((n) => toggle(n, true));
  params.disable.forEach((n) => toggle(n, false));

  const merged = parseAppStoreConfig({ catalogs, allowedTrust: params.allowedTrust ?? base.value.allowedTrust });

  return merged.ok === true ? { ok: true, value: { appStore: merged.value, missing, fixedToggles } } : merged;
}

/** Whether a merge changes nothing (the cluster had an `appStore` already and it normalizes to the same value). */
export function appStoreUnchanged(current: unknown, next: AppStoreConfig): boolean {
  if (current === undefined || current === null) return false;

  const parsed = parseAppStoreConfig(current);

  return parsed.ok && JSON.stringify(parsed.value) === JSON.stringify(next);
}

/** The Cluster resource for the plan: its metadata (name, labels, annotations) and spec with the new `appStore`. */
export function clusterAppStoreDocument(
  resource: { apiVersion?: string; kind?: string; metadata?: Record<string, unknown>; spec?: unknown },
  appStore: AppStoreConfig,
): Record<string, unknown> {
  const name = resource.metadata?.['name'];

  if (resource.kind !== 'Cluster' || typeof name !== 'string' || !resource.spec || typeof resource.spec !== 'object')
    throw new Error('the cluster returned no Cluster resource');

  const labels = resource.metadata?.['labels'];
  const annotations = resource.metadata?.['annotations'];

  return {
    apiVersion: resource.apiVersion ?? 'loadweaver.com/v1',
    kind: 'Cluster',
    metadata: { name, ...(labels ? { labels } : {}), ...(annotations ? { annotations } : {}) },
    spec: { ...(resource.spec as Record<string, unknown>), appStore },
  };
}
