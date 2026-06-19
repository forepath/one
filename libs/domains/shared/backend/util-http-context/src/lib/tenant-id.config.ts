export const DEFAULT_TENANT = 'default';

export const TENANT_ID_HEADER = 'x-tenant';

const MAX_TENANT_ID_LENGTH = 64;

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Parses `TENANTS` env (comma-separated). Always includes {@link DEFAULT_TENANT}.
 * Empty or unset env → only `default`.
 */
export function parseConfiguredTenants(envValue: string | undefined = process.env['TENANTS']): readonly string[] {
  const extras =
    envValue
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== DEFAULT_TENANT) ?? [];

  return [DEFAULT_TENANT, ...extras];
}

export function isValidTenantIdFormat(tenantId: string): boolean {
  const trimmed = tenantId.trim();

  return trimmed.length > 0 && trimmed.length <= MAX_TENANT_ID_LENGTH && TENANT_ID_PATTERN.test(trimmed);
}

export function isConfiguredTenant(
  tenantId: string,
  configuredTenants: readonly string[] = parseConfiguredTenants(),
): boolean {
  return configuredTenants.includes(tenantId);
}

/**
 * Resolves tenant id from an incoming header value.
 * Missing/blank → {@link DEFAULT_TENANT}.
 * Invalid format or not in configured list → `undefined`.
 */
export function resolveTenantIdFromHeader(
  headerValue: string | undefined,
  configuredTenants: readonly string[] = parseConfiguredTenants(),
): string | undefined {
  const raw = headerValue?.trim();
  const tenantId = raw && raw.length > 0 ? raw : DEFAULT_TENANT;

  if (!isValidTenantIdFormat(tenantId)) {
    return undefined;
  }

  if (!isConfiguredTenant(tenantId, configuredTenants)) {
    return undefined;
  }

  return tenantId;
}

export function readIncomingTenantIdFromHeaders(headers: Record<string, unknown> | undefined): string | undefined {
  if (!headers) {
    return undefined;
  }

  const raw = headers[TENANT_ID_HEADER];
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;

  return resolveTenantIdFromHeader(value);
}

export function readIncomingTenantIdFromHandshake(
  headers: Record<string, unknown> | undefined,
  auth?: Record<string, unknown>,
): string | undefined {
  const fromHeader = readIncomingTenantIdFromHeaders(headers);

  if (fromHeader) {
    return fromHeader;
  }

  const authValue = auth?.['tenantId'] ?? auth?.['X-Tenant'];
  const value = typeof authValue === 'string' ? authValue : undefined;

  return resolveTenantIdFromHeader(value);
}
