export const DEFAULT_TENANT = 'default';

export const TENANT_ID_HEADER = 'x-tenant';

export const TENANTS_ALLOW_DEFAULT_ENV = 'TENANTS_ALLOW_DEFAULT';

const MAX_TENANT_ID_LENGTH = 64;

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Whether the `default` tenant is included in the configured allowlist.
 * `TENANTS_ALLOW_DEFAULT=false` excludes it; unset or any other value keeps current behavior.
 */
export function isDefaultTenantAllowed(envValue: string | undefined = process.env[TENANTS_ALLOW_DEFAULT_ENV]): boolean {
  const trimmed = envValue?.trim();

  if (!trimmed) {
    return true;
  }

  return trimmed.toLowerCase() !== 'false';
}

/**
 * Parses `TENANTS` env (comma-separated). Includes {@link DEFAULT_TENANT} unless
 * {@link TENANTS_ALLOW_DEFAULT_ENV} is `false`.
 * Empty or unset `TENANTS` → only `default` when default is allowed; otherwise none.
 */
export function parseConfiguredTenants(envValue: string | undefined = process.env['TENANTS']): readonly string[] {
  const extras =
    envValue
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== DEFAULT_TENANT) ?? [];

  if (!isDefaultTenantAllowed()) {
    return extras;
  }

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
 * Missing/blank → {@link DEFAULT_TENANT} when default is allowed; otherwise `undefined`.
 * Explicit `default` is rejected when {@link TENANTS_ALLOW_DEFAULT_ENV} is `false`.
 * Invalid format or not in configured list → `undefined`.
 */
export function resolveTenantIdFromHeader(
  headerValue: string | undefined,
  configuredTenants: readonly string[] = parseConfiguredTenants(),
): string | undefined {
  const raw = headerValue?.trim();
  const allowDefault = isDefaultTenantAllowed();

  if (!raw) {
    if (!allowDefault) {
      return undefined;
    }

    return isConfiguredTenant(DEFAULT_TENANT, configuredTenants) ? DEFAULT_TENANT : undefined;
  }

  if (raw === DEFAULT_TENANT && !allowDefault) {
    return undefined;
  }

  if (!isValidTenantIdFormat(raw)) {
    return undefined;
  }

  if (!isConfiguredTenant(raw, configuredTenants)) {
    return undefined;
  }

  return raw;
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
