import { getProviderLocationFallbackLabels } from './provider-location-fallbacks';
import type { ProviderLocationDto, ProvisioningGeographyProviderId } from './provider-location.types';

export type ProviderLocationCatalog = Map<string, ProviderLocationDto>;

export function providerLocationCatalogFromList(locations: ProviderLocationDto[]): ProviderLocationCatalog {
  const catalog = new Map<string, ProviderLocationDto>();

  for (const location of locations) {
    const id = location.id?.trim();

    if (id) {
      catalog.set(id, location);
    }
  }

  return catalog;
}

/**
 * Merges API locations with static fallback entries so UIs still work when the API is partial or unavailable.
 */
export function buildProviderLocationCatalog(
  providerId: ProvisioningGeographyProviderId | string,
  apiLocations: ProviderLocationDto[] | null,
): ProviderLocationDto[] {
  const catalog = providerLocationCatalogFromList(apiLocations ?? []);
  const fallbacks = getProviderLocationFallbackLabels(providerId);

  for (const [id, label] of Object.entries(fallbacks)) {
    if (!catalog.has(id)) {
      catalog.set(id, { id, name: label });
    }
  }

  return [...catalog.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves a human-readable label for a geography slug.
 * Fallback chain: catalog/API entry → static provider map → technical slug.
 */
export function resolveProviderLocationLabel(
  providerId: ProvisioningGeographyProviderId | string,
  slug: string,
  catalog?: ProviderLocationDto[] | ProviderLocationCatalog,
): string {
  const normalizedSlug = slug?.trim();

  if (!normalizedSlug) {
    return '';
  }

  if (catalog) {
    const fromCatalog =
      catalog instanceof Map ? catalog.get(normalizedSlug) : catalog.find((item) => item.id === normalizedSlug);

    if (fromCatalog?.name?.trim()) {
      return fromCatalog.name.trim();
    }
  }

  const fallback = getProviderLocationFallbackLabels(providerId)[normalizedSlug];

  if (fallback?.trim()) {
    return fallback.trim();
  }

  return normalizedSlug;
}

/**
 * Builds a display name from live server metadata (e.g. Hetzner city) with static/slug fallbacks.
 */
export function resolveHetznerLocationNameFromMetadata(
  slug: string | undefined,
  city: string | undefined,
  catalog?: ProviderLocationDto[] | ProviderLocationCatalog,
): string | undefined {
  const trimmedCity = city?.trim();

  if (trimmedCity) {
    return trimmedCity;
  }

  const trimmedSlug = slug?.trim();

  if (!trimmedSlug) {
    return undefined;
  }

  return resolveProviderLocationLabel('hetzner', trimmedSlug, catalog);
}
