import { createHash } from 'node:crypto';

import {
  APP_NAME_PATTERN,
  defaultAppStoreConfig,
  OFFICIAL_CATALOG_NAME,
  parseAppStoreConfig,
  sameCatalogUrl,
  signingKeyType,
  type AppStoreConfig,
  type CatalogSource,
  type CatalogType,
} from '@forepath/loadweaver/shared/util-app-catalog';

import type { TrustedFleetCatalog } from '../fleet-identity/fleet-identity.entities';

/** Where the official ForePath catalog lives unless `LOADWEAVER_APP_CATALOG_OFFICIAL_URL` says otherwise. */
export const DEFAULT_OFFICIAL_CATALOG_URL = 'oci://ghcr.io/forepath/loadweaver-apps';

/**
 * Whether trusted fleets may serve their catalog over plain http (`LOADWEAVER_APP_CATALOG_FLEET_ALLOW_INSECURE_HTTP=true`,
 * never in production; local labs where the fleet has no TLS endpoint). Applies to the registration's catalog URL and
 * the fetch; signatures are verified either way.
 */
export function fleetCatalogAllowsHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env['LOADWEAVER_APP_CATALOG_FLEET_ALLOW_INSECURE_HTTP']?.trim().toLowerCase() === 'true' &&
    env['NODE_ENV'] !== 'production'
  );
}

/**
 * Whether a trusted fleet's catalog is fetched with certificate verification
 * (`LOADWEAVER_APP_CATALOG_FLEET_TLS_REJECT_UNAUTHORIZED=false` turns it off for those fetches only, never in
 * production; labs with a self-signed fleet certificate). Signatures are verified either way.
 */
export function fleetCatalogTlsRejectUnauthorized(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env['LOADWEAVER_APP_CATALOG_FLEET_TLS_REJECT_UNAUTHORIZED']?.trim().toLowerCase() !== 'false' ||
    env['NODE_ENV'] === 'production'
  );
}

/** The official catalog as this control plane knows it: its location and the ForePath key that ships with it. */
export interface OfficialCatalog {
  type: CatalogType;
  url: string;
  ref?: string;
  /** PEM public keys; empty while no official key is configured (the catalog can't be enabled then). */
  publicKeys: string[];
}

/**
 * The official catalog from the environment: `LOADWEAVER_APP_CATALOG_OFFICIAL_URL` (`oci://…` or a Git `https://…`
 * URL; default {@link DEFAULT_OFFICIAL_CATALOG_URL}), `LOADWEAVER_APP_CATALOG_OFFICIAL_REF` (Git only) and
 * `LOADWEAVER_APP_CATALOG_OFFICIAL_KEY` (PEM public key(s); `\n` escapes accepted). Keys that aren't ECDSA P-256 /
 * Ed25519 are dropped.
 */
export function officialCatalogFromEnv(env: NodeJS.ProcessEnv = process.env): OfficialCatalog {
  const url = env['LOADWEAVER_APP_CATALOG_OFFICIAL_URL']?.trim() || DEFAULT_OFFICIAL_CATALOG_URL;
  const type: CatalogType = url.startsWith('oci://') ? 'oci' : 'git';
  const ref = type === 'git' ? env['LOADWEAVER_APP_CATALOG_OFFICIAL_REF']?.trim() || undefined : undefined;
  const raw = (env['LOADWEAVER_APP_CATALOG_OFFICIAL_KEY'] ?? '').replace(/\\n/g, '\n');
  const publicKeys = (raw.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g) ?? [])
    .map((k) => `${k.trim()}\n`)
    .filter((k) => signingKeyType(k) !== null);

  return { type, url, ...(ref ? { ref } : {}), publicKeys };
}

/** The trusted fleet that manages a catalog entry (shown as "Managed by fleet <name>"). */
export interface CatalogFleetManager {
  issuer: string;
  name: string;
}

/** A catalog source in effect; `fleet` marks the fixed entry of a trusted fleet's catalog. */
export type EffectiveCatalogSource = CatalogSource & { fleet?: CatalogFleetManager };

export interface EffectiveAppStoreConfig extends AppStoreConfig {
  catalogs: EffectiveCatalogSource[];
}

/** What {@link effectiveAppStoreConfig} needs of a trusted fleet. */
export interface TrustedFleetCatalogOwner {
  issuer: string;
  name: string;
  catalog: TrustedFleetCatalog | null;
}

/** A DNS label from free text (lowercase, runs of anything else → `-`, at most 63 characters), or `''`. */
function catalogSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 63)
    .replace(/^-+|-+$/g, '');
}

/**
 * The name a fleet's catalog entry is pinned to (2026-11-01): the name the registration carries (`FLEET_CATALOG_NAME`
 * of the fleet), else — older fleets, registrations stored before — the fleet's registered name, else its issuer,
 * slugified (`Acme fleet` → `acme-fleet`; `fleet` when neither gives one).
 */
export function fleetCatalogBaseName(
  fleet: Pick<TrustedFleetCatalogOwner, 'issuer' | 'name'> & { catalog?: Pick<TrustedFleetCatalog, 'name'> | null },
): string {
  const pinned = fleet.catalog?.name;

  if (pinned && APP_NAME_PATTERN.test(pinned)) return pinned;

  return [catalogSlug(fleet.name), catalogSlug(fleet.issuer)].find((s) => APP_NAME_PATTERN.test(s)) ?? 'fleet';
}

/**
 * The name of a fleet's fixed catalog entry: {@link fleetCatalogBaseName}, with `-2`, `-3`, … when another catalog
 * already has it (stable: the fleets are added in issuer order after the stored catalogs).
 */
export function fleetCatalogName(
  fleet: Pick<TrustedFleetCatalogOwner, 'issuer' | 'name'> & { catalog?: Pick<TrustedFleetCatalog, 'name'> | null },
  taken: ReadonlySet<string>,
): string {
  const base = fleetCatalogBaseName(fleet);

  if (!taken.has(base)) return base;

  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const name = `${base.slice(0, 63 - suffix.length).replace(/-+$/, '')}${suffix}`;

    if (!taken.has(name)) return name;
  }
}

/**
 * The app store configuration in effect: `Cluster.spec.appStore`, or the default (official catalog, disabled) when
 * absent. A list without an official catalog gets it added (disabled) unless a catalog already uses its name. An
 * invalid stored value (it is validated on write) falls back to the default.
 *
 * Every trusted fleet that registered a catalog gets a fixed `type: fleet` entry (2026-11-01): a stored `type: fleet`
 * entry for the same URL becomes it (forced enabled), else one is added (named by {@link fleetCatalogName}: the pinned
 * name of the registration; keys from the registration). Writes can't remove or switch it off — it is derived here on every read for as long as the
 * registration exists — and `allowedTrust` applies to its apps like to any other catalog's.
 */
export function effectiveAppStoreConfig(
  raw: unknown,
  official: Pick<OfficialCatalog, 'type' | 'url' | 'ref'>,
  fleets: readonly TrustedFleetCatalogOwner[] = [],
): EffectiveAppStoreConfig {
  return withFleetCatalogs(storedAppStoreConfig(raw, official), fleets);
}

function storedAppStoreConfig(raw: unknown, official: Pick<OfficialCatalog, 'type' | 'url' | 'ref'>): AppStoreConfig {
  const fallback = defaultAppStoreConfig({
    type: official.type,
    url: official.url,
    ...(official.ref ? { ref: official.ref } : {}),
  });

  if (raw === undefined || raw === null) return fallback;

  const parsed = parseAppStoreConfig(raw);

  if (parsed.ok === false) return fallback;

  const config: AppStoreConfig = parsed.value;

  if (config.catalogs.some((c) => c.official || c.name === OFFICIAL_CATALOG_NAME)) return config;

  return { ...config, catalogs: [fallback.catalogs[0], ...config.catalogs] };
}

/** Pins / adds the fixed entries of the trusted fleets' catalogs (issuer order, so the derived names stay stable). */
function withFleetCatalogs(
  config: AppStoreConfig,
  fleets: readonly TrustedFleetCatalogOwner[],
): EffectiveAppStoreConfig {
  const catalogs: EffectiveCatalogSource[] = [...config.catalogs];
  const owners = fleets
    .filter((f): f is TrustedFleetCatalogOwner & { catalog: TrustedFleetCatalog } => !!f.catalog?.url)
    .sort((a, b) => a.issuer.localeCompare(b.issuer));

  for (const fleet of owners) {
    const manager: CatalogFleetManager = { issuer: fleet.issuer, name: fleet.name };
    const index = catalogs.findIndex(
      (c) => c.type === 'fleet' && !c.official && sameCatalogUrl(c.url, fleet.catalog.url),
    );

    if (index >= 0) {
      // Two fleets registering the same URL: the first one (issuer order) manages the entry.
      if (!catalogs[index].fleet) catalogs[index] = { ...catalogs[index], enabled: true, fleet: manager };

      continue;
    }

    catalogs.push({
      name: fleetCatalogName(fleet, new Set(catalogs.map((c) => c.name))),
      type: 'fleet',
      url: fleet.catalog.url,
      enabled: true,
      fleet: manager,
    });
  }

  return { ...config, catalogs };
}

export { sameCatalogUrl };

/**
 * Plan / draft warnings (2026-11-01): a change of `Cluster.spec.appStore` that removes a stored entry for a trusted
 * fleet's catalog or switches one off. Accepted — the fixed entry stays enabled while the cluster trusts the fleet —
 * but said, so nobody expects it to take effect. Unparseable values are left to the resource validation.
 */
export function fleetManagedCatalogWarnings(
  before: unknown,
  after: unknown,
  fleets: readonly TrustedFleetCatalogOwner[],
): { level: 'warning'; path: string; message: string }[] {
  const stored = (raw: unknown) => {
    if (raw === undefined || raw === null) return [];

    const parsed = parseAppStoreConfig(raw);

    return parsed.ok === true ? parsed.value.catalogs : null;
  };
  const was = stored(before);
  const now = stored(after);

  if (!was || !now) return [];

  const warnings: { level: 'warning'; path: string; message: string }[] = [];
  const owners = fleets
    .filter((f): f is TrustedFleetCatalogOwner & { catalog: TrustedFleetCatalog } => !!f.catalog?.url)
    .sort((a, b) => a.issuer.localeCompare(b.issuer));

  for (const fleet of owners) {
    const match = (c: CatalogSource) => c.type === 'fleet' && !c.official && sameCatalogUrl(c.url, fleet.catalog.url);
    const old = was.find(match);
    const next = now.find(match);
    const name = !next && old ? old.name : next && !next.enabled && old?.enabled !== false ? next.name : null;

    if (name)
      warnings.push({
        level: 'warning',
        path: 'appStore.catalogs',
        message: `${name} is managed by fleet ${fleet.name}; disabling or removing it has no effect (it stays enabled while the cluster trusts the fleet)`,
      });
  }

  return warnings;
}

export interface ResolvedCatalogKeys {
  keys: string[];
  /** Where the keys come from (shown on `GET /apps/catalogs`). */
  origin: 'official' | 'configured' | 'fleet' | 'none';
  /** A `type: fleet` source served by a fleet registered as trusted (its private addresses are allowed). */
  trustedFleet: boolean;
}

/**
 * The keys a catalog's index must be signed with: the shipped ForePath key for `official: true`, the configured
 * `publicKeys`, or — for `type: fleet` without keys — the catalog keys of the trusted fleet registered for its URL.
 */
export function catalogKeys(
  source: CatalogSource,
  official: Pick<OfficialCatalog, 'publicKeys'>,
  fleets: readonly { catalog: TrustedFleetCatalog | null }[],
): ResolvedCatalogKeys {
  const fleet =
    source.type === 'fleet' ? fleets.find((f) => f.catalog && sameCatalogUrl(f.catalog.url, source.url)) : undefined;
  const trustedFleet = !!fleet;

  if (source.official)
    return { keys: [...official.publicKeys], origin: official.publicKeys.length ? 'official' : 'none', trustedFleet };

  if (source.publicKeys?.length) return { keys: [...source.publicKeys], origin: 'configured', trustedFleet };

  if (fleet?.catalog?.publicKeys.length) return { keys: [...fleet.catalog.publicKeys], origin: 'fleet', trustedFleet };

  return { keys: [], origin: 'none', trustedFleet };
}

/** Binds a cached index to what it was verified against: type, URL, ref and keys. */
export function catalogSourceHash(
  source: Pick<CatalogSource, 'type' | 'url' | 'ref'>,
  keys: readonly string[],
): string {
  return createHash('sha256')
    .update(JSON.stringify([source.type, source.url, source.ref ?? null, [...keys].map((k) => k.trim()).sort()]))
    .digest('hex');
}

/** A URL for display: no credentials, query or fragment (`oci://` URLs are shown as they are). */
export function displayCatalogUrl(url: string): string {
  if (url.startsWith('oci://')) return url;

  try {
    const parsed = new URL(url);

    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '';
  }
}
