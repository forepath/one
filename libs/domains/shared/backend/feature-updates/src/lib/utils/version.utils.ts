import { compare, coerce } from 'semver';

import type { UpdateState } from '../interfaces/updates.interfaces';

const DEFAULT_VERSION_ENVS = ['VERSION', 'APP_VERSION'] as const;

/** Unresolved shell/Nx placeholders such as `$VERSION` or `${APP_VERSION}`. */
const UNRESOLVED_ENV_PLACEHOLDER_RE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;

export function isUsableInstalledVersion(value: string | undefined | null): boolean {
  const trimmed = value?.trim();

  if (!trimmed) {
    return false;
  }

  return !UNRESOLVED_ENV_PLACEHOLDER_RE.test(trimmed);
}

export function getInstalledVersion(env: NodeJS.ProcessEnv = process.env, versionEnv?: string): string {
  const envKeys = versionEnv ? [versionEnv, ...DEFAULT_VERSION_ENVS] : [...DEFAULT_VERSION_ENVS];
  const seen = new Set<string>();

  for (const key of envKeys) {
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const value = env[key]?.trim();

    if (isUsableInstalledVersion(value)) {
      return value as string;
    }
  }

  return '0.0.0';
}

/** Semver order; prereleases (`3.6.0-beta.1`) sort before their release. */
export function compareVersions(left: string, right: string): number | null {
  const leftCoerced = coerce(left, { includePrerelease: true });
  const rightCoerced = coerce(right, { includePrerelease: true });

  if (!leftCoerced || !rightCoerced) {
    return null;
  }

  return compare(leftCoerced, rightCoerced);
}

export function resolveUpdateState(installed: string, latest: string | null | undefined): UpdateState {
  if (!latest) {
    return 'unknown';
  }

  const comparison = compareVersions(installed, latest);

  if (comparison === null) {
    return 'unknown';
  }

  if (comparison < 0) {
    return 'update_available';
  }

  return 'up_to_date';
}

export function normalizeVersion(value: string): string | null {
  const coerced = coerce(value, { includePrerelease: true });

  return coerced ? coerced.version : null;
}
