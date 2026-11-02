/**
 * Release versions (3.26): the repository's release tag (`3.5.0`, with or without a leading `v`); prereleases
 * (`3.6.0-beta.1`) are the beta channel. A small semver subset: no build metadata in comparisons.
 */
export interface ReleaseVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: (string | number)[];
}

const VERSION =
  /^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** A plain release version (`3.5.0`, `3.6.0-beta.1`); the form stored in manifests and the database. */
export const RELEASE_VERSION_PATTERN =
  /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export function parseVersion(value: string): ReleaseVersion | null {
  const match = VERSION.exec(value.trim());

  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

/** `3.5.0` from `v3.5.0`; null when it isn't a version. */
export function normalizeVersion(value: string): string | null {
  const v = parseVersion(value);

  return v ? formatVersion(v) : null;
}

export function formatVersion(v: ReleaseVersion): string {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease.length ? `-${v.prerelease.join('.')}` : ''}`;
}

function comparePrerelease(a: ReleaseVersion['prerelease'], b: ReleaseVersion['prerelease']): number {
  // A release sorts after its prereleases.
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;

    if (b[i] === undefined) return 1;

    if (a[i] === b[i]) continue;

    if (typeof a[i] === 'number' && typeof b[i] === 'number') return (a[i] as number) < (b[i] as number) ? -1 : 1;

    if (typeof a[i] === 'number') return -1;

    if (typeof b[i] === 'number') return 1;

    return String(a[i]) < String(b[i]) ? -1 : 1;
  }

  return 0;
}

/** Semver order; throws on values that aren't versions. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);

  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);

  for (const key of ['major', 'minor', 'patch'] as const) if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;

  return comparePrerelease(x.prerelease, y.prerelease);
}

export function isPrerelease(value: string): boolean {
  return (parseVersion(value)?.prerelease.length ?? 0) > 0;
}

/** What an update from `from` to `to` is (3.26): patch releases may apply automatically, minor / major need a plan. */
export type UpdateKind = 'patch' | 'minor' | 'major' | 'downgrade' | 'none';

export function updateKind(from: string, to: string): UpdateKind {
  const x = parseVersion(from);
  const y = parseVersion(to);

  if (!x || !y) throw new Error(`not a version: ${!x ? from : to}`);

  const order = compareVersions(from, to);

  if (order === 0) return 'none';

  if (order > 0) return 'downgrade';

  if (y.major !== x.major) return 'major';

  if (y.minor !== x.minor) return 'minor';

  return 'patch';
}

/**
 * Whether `client` is at most one release line behind `cluster` (N-1, 3.26): same major and at most one minor
 * behind, or newer. Used by the CLI's version warning and the control plane's agent compatibility check.
 */
export function withinOneMinor(client: string, cluster: string): boolean {
  const c = parseVersion(client);
  const s = parseVersion(cluster);

  if (!c || !s) return true;

  if (compareVersions(client, cluster) >= 0) return true;

  // Across a major release the previous line isn't known here: older majors always warn.
  if (c.major !== s.major) return false;

  return s.minor - c.minor <= 1;
}
