import type { FetchRuntimeConfigEnv } from './runtime-config-proxy';

/** Minimal surface used by Express `Response#setHeader`. */
export type RuntimeConfigHttpResponse = {
  setHeader(name: string, value: string | number | readonly string[]): void;
};

export type RuntimeConfigCacheResponseKind = 'success' | 'error';

/**
 * Sets caching policy for `GET /config` responses.
 *
 * - **Success** (`no_config` empty object, proxied JSON): `private` so shared caches do not store
 *   deployment-specific config. In production: short `max-age` plus `stale-while-revalidate` to
 *   limit upstream load while allowing quick rollout visibility. In non-production: `no-cache` for
 *   fresher local iteration.
 * - **Error**: `no-store` so clients and proxies do not retain failure placeholders.
 */
export function applyRuntimeConfigResponseCacheHeaders(
  res: RuntimeConfigHttpResponse,
  kind: RuntimeConfigCacheResponseKind,
  env: Pick<FetchRuntimeConfigEnv, 'NODE_ENV'> = {},
): void {
  if (kind === 'error') {
    res.setHeader('Cache-Control', 'no-store');

    return;
  }

  if (env.NODE_ENV === 'production') {
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
  } else {
    res.setHeader('Cache-Control', 'private, no-cache');
  }
}
