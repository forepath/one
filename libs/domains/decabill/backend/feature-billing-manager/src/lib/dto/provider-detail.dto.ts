import type { DeclaredMeterDefinition } from './declared-meter.dto';

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

  /**
   * When true, plans for this provider may offer customer-selectable addons.
   * Omitted / false for providers that lack provision/teardown or cloud-init append hooks.
   */
  supportsAddons?: boolean;

  /**
   * When true, in-place server type upgrades are supported for this provider.
   * Fail-closed: omitted / false means upgrades are not offered.
   */
  supportsServerTypeUpgrade?: boolean;

  /**
   * When true, in-place server type downgrades are supported for this provider.
   * Fail-closed: omitted / false means downgrades are not offered.
   */
  supportsServerTypeDowngrade?: boolean;

  /**
   * Required usage meters declared by the provider (or product) implementation.
   * Sideloaded onto service types as non-removable attachments.
   */
  meters?: DeclaredMeterDefinition[];
}
