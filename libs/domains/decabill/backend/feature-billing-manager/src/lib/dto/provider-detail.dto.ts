export interface ProviderEnvDefaultField {
  envKey: string;
  label: string;
  sensitive: boolean;
  type: 'string';
}

/**
 * DTO for a billing provider detail returned by GET /service-types/providers.
 * Describes a provisioning provider (e.g. Hetzner) with id, display name, and optional config schema.
 */
export class ProviderDetailDto {
  /**
   * Provider identifier (e.g. hetzner). Used as the value for service type provider field.
   */
  id!: string;

  /**
   * Human-readable display name (e.g. Hetzner Cloud-Init).
   */
  displayName!: string;

  /**
   * Optional JSON schema for provider-specific configuration when creating subscriptions.
   */
  configSchema?: Record<string, unknown>;

  /**
   * Platform env vars that can be overridden per service type (e.g. HETZNER_API_TOKEN).
   */
  envDefaultFields?: ProviderEnvDefaultField[];
}
