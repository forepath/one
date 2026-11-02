import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';

/** `apiVersion` of manifests and catalog indexes. */
export const APP_STORE_API_VERSION = 'apps.loadweaver.com/v1';

/** Result of every parser / reader in this library: a typed value or readable errors (`path: message`). */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Trust labels, strongest first. */
export const TRUST_LABELS = ['official', 'verified', 'community'] as const;
export type TrustLabel = (typeof TRUST_LABELS)[number];

/** App / catalog / package name: a DNS label. */
export const APP_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Semantic version 2.0.0 (no leading `v`). */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** `sha256:<64 hex>` (OCI digest form). */
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Key id: SHA-256 (hex) of the public key's SPKI DER. */
export const KEY_ID_PATTERN = /^[0-9a-f]{64}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') return `${acc}[${key}]`;

    return acc ? `${acc}.${String(key)}` : String(key);
  }, '');
}

/** `path: message` lines for a zod error. */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = formatPath(issue.path);

    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Parses YAML text (or takes an already parsed value) and validates it with a zod schema. Strings and byte arrays
 * are YAML; anything else is validated as is.
 */
export function parseWithSchema<S extends z.ZodType>(
  source: string | Uint8Array | unknown,
  schema: S,
  what: string,
): ParseResult<z.infer<S>> {
  let raw: unknown = source;

  if (typeof source === 'string' || source instanceof Uint8Array) {
    const text = typeof source === 'string' ? source : Buffer.from(source).toString('utf8');

    try {
      raw = parseYaml(text, { maxAliasCount: 100, uniqueKeys: true });
    } catch (error) {
      return { ok: false, errors: [`${what} is not valid YAML: ${(error as Error).message.split('\n')[0]}`] };
    }
  }

  if (raw === undefined || raw === null) return { ok: false, errors: [`${what} is empty`] };

  const parsed = schema.safeParse(raw);

  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, errors: formatZodIssues(parsed.error) };
}

function prereleaseParts(version: string): (string | number)[] {
  const match = SEMVER_PATTERN.exec(version);

  if (!match?.[4]) return [];

  return match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/**
 * Compares two semantic versions (SemVer 2.0.0 precedence; build metadata is ignored). Negative when `a < b`, 0 when
 * equal, positive when `a > b`. Throws on invalid versions.
 */
export function compareVersions(a: string, b: string): number {
  const ma = SEMVER_PATTERN.exec(a);
  const mb = SEMVER_PATTERN.exec(b);

  if (!ma || !mb) throw new Error(`invalid semantic version: ${!ma ? a : b}`);

  for (let i = 1; i <= 3; i++) {
    const diff = Number(ma[i]) - Number(mb[i]);

    if (diff !== 0) return Math.sign(diff);
  }

  const pa = prereleaseParts(a);
  const pb = prereleaseParts(b);

  if (pa.length === 0 || pb.length === 0) return pb.length - pa.length === 0 ? 0 : pa.length === 0 ? 1 : -1;

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;

    if (pb[i] === undefined) return 1;

    if (pa[i] === pb[i]) continue;

    if (typeof pa[i] === 'number' && typeof pb[i] === 'number') return Math.sign((pa[i] as number) - (pb[i] as number));

    if (typeof pa[i] === 'number') return -1;

    if (typeof pb[i] === 'number') return 1;

    return (pa[i] as string) < (pb[i] as string) ? -1 : 1;
  }

  return 0;
}

/** Rank of a trust label: 0 = official (strongest). */
export function trustRank(label: TrustLabel): number {
  return TRUST_LABELS.indexOf(label);
}

/**
 * A control-plane version that can't be compared: missing, not semantic, `0.0.0…` or a development pre-release
 * (`4.2.0-dev.3`). `minLoadweaver` is not enforced against it (development builds stay usable).
 */
export function isUnknownLoadweaverVersion(version: string | null | undefined): boolean {
  const match = SEMVER_PATTERN.exec(version?.trim().replace(/^v/, '') ?? '');

  if (!match) return true;

  return (match[1] === '0' && match[2] === '0' && match[3] === '0') || /(^|\.)dev/i.test(match[4] ?? '');
}

/** Outcome of the `minLoadweaver` check: allowed (with a note when the version is unknown), or refused with why. */
export type MinLoadweaverCheck = { ok: true; warning?: string } | { ok: false; reason: string };

/**
 * Whether a package's `minLoadweaver` admits the running control plane. Older clusters are refused; an unknown /
 * development version is allowed with a warning.
 */
export function checkMinLoadweaver(
  minLoadweaver: string | null | undefined,
  running: string | null | undefined,
): MinLoadweaverCheck {
  if (!minLoadweaver) return { ok: true };

  if (isUnknownLoadweaverVersion(running))
    return {
      ok: true,
      warning: `needs Loadweaver ${minLoadweaver} or newer; the control plane's version is unknown (development build), so this isn't checked`,
    };

  const version = (running as string).trim().replace(/^v/, '');

  return compareVersions(version, minLoadweaver) < 0
    ? { ok: false, reason: `needs Loadweaver ${minLoadweaver} or newer; this cluster runs ${version}` }
    : { ok: true };
}
