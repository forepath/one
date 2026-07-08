/**
 * Server type selection for provisioning plans uses `basePriceFromField: 'serverType'` in provider schemas.
 * These helpers gate customer overrides and validate allowed types on order.
 */

export interface JsonSchemaLike {
  basePriceFromField?: unknown;
}

/**
 * True when the schema defines server type as the field that drives base price.
 */
export function providerConfigSchemaSupportsServerTypeSelection(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;

  const field = (schema as JsonSchemaLike).basePriceFromField;

  return field === 'serverType';
}

/**
 * Service types often persist `configSchema` as `{}` and rely on the provider's registered default schema.
 */
export function effectiveSchemaSupportsServerTypeSelection(
  serviceTypeConfigSchema: unknown,
  providerRegisteredConfigSchema: unknown | undefined,
): boolean {
  if (providerConfigSchemaSupportsServerTypeSelection(serviceTypeConfigSchema)) {
    return true;
  }

  return providerConfigSchemaSupportsServerTypeSelection(providerRegisteredConfigSchema);
}

/**
 * Shallow copy of requestedConfig without serverType when customer selection is disabled.
 */
export function stripServerTypeFromRequestedConfig(
  requestedConfig: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const src = requestedConfig ?? {};
  const out: Record<string, unknown> = { ...src };

  delete out['serverType'];

  return out;
}

/**
 * Returns an error message when serverType is not in the allowed list, or null when valid.
 */
export function assertServerTypeAllowed(serverType: string, allowedServerTypes: string[]): string | null {
  const trimmed = serverType?.trim();

  if (!trimmed) {
    return 'serverType is required';
  }

  if (!Array.isArray(allowedServerTypes) || allowedServerTypes.length === 0) {
    return 'No server types are configured for customer selection on this plan';
  }

  if (!allowedServerTypes.includes(trimmed)) {
    return `serverType "${trimmed}" is not allowed for this plan`;
  }

  return null;
}

/**
 * Normalizes allowed server types: non-empty strings only, deduplicated, order preserved.
 */
export function normalizeAllowedServerTypes(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') continue;

    const trimmed = value.trim();

    if (!trimmed || seen.has(trimmed)) continue;

    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
}
