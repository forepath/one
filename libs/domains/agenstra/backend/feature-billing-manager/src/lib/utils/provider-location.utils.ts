/**
 * Geography for Hetzner/DigitalOcean is modeled as `region` (DO) or `location` (Hetzner) in config schemas.
 * Provisioning and availability use a single string; these helpers normalize and gate customer overrides.
 */

export interface JsonSchemaLikeProperty {
  type?: string;
  enum?: unknown[];
}

export interface JsonSchemaLike {
  properties?: Record<string, JsonSchemaLikeProperty>;
}

function isNonEmptyStringEnum(prop: JsonSchemaLikeProperty | undefined): boolean {
  if (!prop || prop.type !== 'string') return false;

  const e = prop.enum;

  return Array.isArray(e) && e.length > 0 && e.every((x) => typeof x === 'string');
}

/**
 * True when the service type schema defines a bounded string geography field (region or location with enum).
 */
export function providerConfigSchemaSupportsLocationSelection(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;

  const props = (schema as JsonSchemaLike).properties ?? {};
  const region = props['region'];
  const location = props['location'];

  return isNonEmptyStringEnum(region) || isNonEmptyStringEnum(location);
}

/**
 * Service types often persist `configSchema` as `{}` and rely on the provider's registered default schema
 * (see BillingModule / GET /service-types/providers). This matches that effective schema for gating.
 */
export function effectiveSchemaSupportsLocationSelection(
  serviceTypeConfigSchema: unknown,
  providerRegisteredConfigSchema: unknown | undefined,
): boolean {
  if (providerConfigSchemaSupportsLocationSelection(serviceTypeConfigSchema)) {
    return true;
  }

  return providerConfigSchemaSupportsLocationSelection(providerRegisteredConfigSchema);
}

/**
 * Canonical geography key for schema-driven UIs (`region` vs `location`). Prefer `region` when both exist.
 */
export function getGeographyFieldKeyFromSchema(schema: unknown): 'region' | 'location' | null {
  if (!schema || typeof schema !== 'object') return null;

  const props = (schema as JsonSchemaLike).properties ?? {};

  if (isNonEmptyStringEnum(props['region'])) return 'region';

  if (isNonEmptyStringEnum(props['location'])) return 'location';

  return null;
}

/**
 * Allowed geography values from schema enum for the canonical field.
 */
export function getGeographyEnumFromSchema(schema: unknown): string[] | null {
  const key = getGeographyFieldKeyFromSchema(schema);

  if (!key) return null;

  const props = (schema as JsonSchemaLike).properties ?? {};
  const prop = props[key];
  const e = prop?.enum;

  if (!Array.isArray(e)) return null;

  return e.filter((x): x is string => typeof x === 'string');
}

const DEFAULT_REGION_HETZNER = 'fsn1';
const DEFAULT_REGION_DIGITALOCEAN = 'fra1';

/**
 * Resolves the provisioning geography string from config (region and location are aliases).
 */
export function resolveProvisioningRegion(config: Record<string, unknown>, provider: string): string {
  const fromConfig = (config['region'] as string | undefined) ?? (config['location'] as string | undefined);

  if (fromConfig?.trim()) return fromConfig.trim();

  return provider === 'digital-ocean' ? DEFAULT_REGION_DIGITALOCEAN : DEFAULT_REGION_HETZNER;
}

/**
 * After resolving geography, mirror into both `region` and `location` so code paths and schemas stay consistent.
 */
export function mirrorGeographyInConfig(config: Record<string, unknown>, value: string): void {
  config['region'] = value;
  config['location'] = value;
}

/**
 * Shallow copy of requestedConfig without geography keys when customer selection is disabled.
 */
export function stripGeographyFromRequestedConfig(
  requestedConfig: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const src = requestedConfig ?? {};
  const out: Record<string, unknown> = { ...src };

  delete out['region'];
  delete out['location'];

  return out;
}
