import type { ProvisioningGeographyProviderId } from './provider-location.types';

/** Static Hetzner location labels aligned with billing provider config schema enums. */
export const HETZNER_LOCATION_FALLBACK_LABELS: Record<string, string> = {
  fsn1: 'Falkenstein',
  nbg1: 'Nuremberg',
  hel1: 'Helsinki',
  ash: 'Ashburn',
  hil: 'Hillsboro',
  sgp: 'Singapore',
};

/** Static DigitalOcean region labels aligned with billing provider config schema enums. */
export const DIGITALOCEAN_REGION_FALLBACK_LABELS: Record<string, string> = {
  ams3: 'Amsterdam 3',
  blr1: 'Bangalore 1',
  fra1: 'Frankfurt 1',
  lon1: 'London 1',
  nyc1: 'New York 1',
  nyc3: 'New York 3',
  sfo2: 'San Francisco 2',
  sfo3: 'San Francisco 3',
  sgp1: 'Singapore 1',
  syd1: 'Sydney 1',
  tor1: 'Toronto 1',
};

export function getProviderLocationFallbackLabels(
  providerId: ProvisioningGeographyProviderId | string,
): Record<string, string> {
  if (providerId === 'hetzner') {
    return HETZNER_LOCATION_FALLBACK_LABELS;
  }

  if (providerId === 'digital-ocean') {
    return DIGITALOCEAN_REGION_FALLBACK_LABELS;
  }

  return {};
}
