import { createHash } from 'node:crypto';

import type { ProviderLocationDto, ProvisioningGeographyProviderId } from './provider-location.types';

/** Default TTL for provider location catalogs (24 hours). */
export const DEFAULT_PROVIDER_LOCATIONS_CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface ProviderLocationsCacheClient {
  getJson<T>(key: string): Promise<T | null>;
  setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export function readProviderLocationsCacheTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = parseInt(
    env['PROVIDER_LOCATIONS_CACHE_TTL_SECONDS'] ?? `${DEFAULT_PROVIDER_LOCATIONS_CACHE_TTL_SECONDS}`,
    10,
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PROVIDER_LOCATIONS_CACHE_TTL_SECONDS;
}

export function buildProviderLocationsCacheKey(
  keyPrefix: string,
  providerId: ProvisioningGeographyProviderId | string,
  apiToken: string,
): string {
  const credentialsScope = createHash('sha256').update(apiToken).digest('hex').slice(0, 16);
  const prefix = keyPrefix.trim() || 'agenstra';

  return `${prefix}:provider-locations:${providerId}:${credentialsScope}`;
}

export async function getOrSetProviderLocationsCatalog(
  cache: ProviderLocationsCacheClient | null | undefined,
  params: {
    keyPrefix: string;
    providerId: ProvisioningGeographyProviderId | string;
    apiToken: string;
    ttlSeconds?: number;
  },
  loader: () => Promise<ProviderLocationDto[]>,
): Promise<ProviderLocationDto[]> {
  if (!cache) {
    return loader();
  }

  const key = buildProviderLocationsCacheKey(params.keyPrefix, params.providerId, params.apiToken);
  const ttlSeconds = params.ttlSeconds ?? readProviderLocationsCacheTtlSeconds();
  const cached = await cache.getJson<ProviderLocationDto[]>(key);

  if (cached) {
    return cached;
  }

  const fresh = await loader();

  await cache.setJson(key, fresh, ttlSeconds);

  return fresh;
}
