import { InjectionToken } from '@angular/core';

import type { BaseEnvironment } from './environment.interface';

export const ENVIRONMENT = new InjectionToken<BaseEnvironment>('Environment');

/** Client-side timeout for `GET /config` so a slow/unreachable CONFIG proxy cannot stall bootstrap. */
export const RUNTIME_CONFIG_CLIENT_FETCH_TIMEOUT_MS = 2000;

/** Must match Express HTML inject id in `@forepath/shared/frontend/util-express-server`. */
export const RUNTIME_CONFIG_ELEMENT_ID = 'runtime-config';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeUnknown(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    result[key] = deepMergeUnknown(base[key], value);
  }

  return result;
}

/**
 * Deep-merges runtime config overrides onto a typed environment base.
 * Nested bags (`application`, `authentication`, `*.urls`, websocket object form, etc.) merge per-key.
 */
export function mergeEnvironmentOverrides<T extends BaseEnvironment>(
  base: T,
  overrides: Partial<T> | null | undefined,
): T {
  if (!overrides) {
    return base;
  }

  return deepMergeUnknown(base, overrides) as T;
}

/**
 * Reads runtime config inlined into the SPA shell by Express (`#runtime-config`).
 * Returns `null` when absent or invalid so callers can fall back to `GET /config`.
 */
export function readInlineRuntimeConfigOverrides<T extends BaseEnvironment = BaseEnvironment>(): Partial<T> | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const element = document.getElementById(RUNTIME_CONFIG_ELEMENT_ID);

  if (!element?.textContent?.trim()) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(element.textContent);

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Partial<T>;
  } catch {
    return null;
  }
}

/**
 * Creates a runtime environment loader bound to a concrete build-time base object.
 * Domain util-configuration packages should export `loadRuntimeEnvironment` via this factory.
 */
export function createLoadRuntimeEnvironment<T extends BaseEnvironment>(base: T): () => Promise<T> {
  return async function loadRuntimeEnvironment(): Promise<T> {
    const inlineOverrides = readInlineRuntimeConfigOverrides<T>();

    if (inlineOverrides !== null) {
      return mergeEnvironmentOverrides(base, inlineOverrides);
    }

    try {
      const response: Response = await fetch('/config', {
        signal: AbortSignal.timeout(RUNTIME_CONFIG_CLIENT_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        return base;
      }

      const overrides: Partial<T> = await response.json();

      return mergeEnvironmentOverrides(base, overrides);
    } catch {
      return base;
    }
  };
}
