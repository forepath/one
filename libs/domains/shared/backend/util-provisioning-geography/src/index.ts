export type { ProviderLocationDto, ProvisioningGeographyProviderId } from './lib/provider-location.types';
export {
  DIGITALOCEAN_REGION_FALLBACK_LABELS,
  HETZNER_LOCATION_FALLBACK_LABELS,
  getProviderLocationFallbackLabels,
} from './lib/provider-location-fallbacks';
export { fetchDigitalOceanRegions, fetchHetznerLocations } from './lib/provider-location-fetch';
export {
  buildProviderLocationCatalog,
  providerLocationCatalogFromList,
  resolveHetznerLocationNameFromMetadata,
  resolveProviderLocationLabel,
} from './lib/provider-location.utils';
export type { ProviderLocationCatalog } from './lib/provider-location.utils';
export {
  DEFAULT_PROVIDER_LOCATIONS_CACHE_TTL_SECONDS,
  buildProviderLocationsCacheKey,
  getOrSetProviderLocationsCatalog,
  readProviderLocationsCacheTtlSeconds,
} from './lib/provider-locations-cache';
export type { ProviderLocationsCacheClient } from './lib/provider-locations-cache';
