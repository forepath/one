/**
 * Geography option returned by provider location/region APIs and static fallbacks.
 * `id` is the technical slug used for provisioning (e.g. fsn1, fra1).
 */
export interface ProviderLocationDto {
  id: string;
  name: string;
  city?: string;
  country?: string;
}

export type ProvisioningGeographyProviderId = 'hetzner' | 'digital-ocean';
