/**
 * Provider geography option (location or region) for UI labels and server metadata display.
 */
export class ProviderLocationDto {
  /** Technical slug used for provisioning (e.g. fsn1, fra1). */
  id!: string;
  /** Human-readable display name. */
  name!: string;
  /** City when provided by the provider API (Hetzner). */
  city?: string;
  /** ISO country code when provided by the provider API. */
  country?: string;
}
