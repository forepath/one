import axios from 'axios';

import type { ProviderLocationDto } from './provider-location.types';

const HETZNER_API_BASE = 'https://api.hetzner.cloud/v1';
const DIGITALOCEAN_API_BASE = 'https://api.digitalocean.com/v2';

interface HetznerLocationResponse {
  id: number;
  name: string;
  description?: string;
  country: string;
  city: string;
  latitude: number;
  longitude: number;
}

interface DigitalOceanRegionResponse {
  name: string;
  slug: string;
  available: boolean;
}

function mapHetznerLocation(location: HetznerLocationResponse): ProviderLocationDto {
  const city = location.city?.trim();
  const description = location.description?.trim();
  const name = city || description || location.name;

  return {
    id: location.name,
    name,
    city: city || undefined,
    country: location.country?.trim() || undefined,
  };
}

function mapDigitalOceanRegion(region: DigitalOceanRegionResponse): ProviderLocationDto {
  const name = region.name?.trim() || region.slug;

  return {
    id: region.slug,
    name,
  };
}

export async function fetchHetznerLocations(apiToken: string): Promise<ProviderLocationDto[]> {
  const response = await axios.get<{ locations: HetznerLocationResponse[] }>(`${HETZNER_API_BASE}/locations`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  return (response.data.locations ?? []).map(mapHetznerLocation);
}

export async function fetchDigitalOceanRegions(apiToken: string): Promise<ProviderLocationDto[]> {
  const response = await axios.get<{ regions: DigitalOceanRegionResponse[] }>(`${DIGITALOCEAN_API_BASE}/regions`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  return (response.data.regions ?? []).filter((region) => region.available).map(mapDigitalOceanRegion);
}
