import { AsyncLocalStorage } from 'node:async_hooks';

import { DEFAULT_TENANT } from './tenant-id.config';

const tenantIdStorage = new AsyncLocalStorage<string>();

/**
 * Runs `fn` with tenant id bound for async continuation (Node async_hooks).
 * Used by HTTP middleware so downstream async work can read the id via `getTenantId()`.
 */
export function runWithTenantId<T>(tenantId: string, fn: () => T): T {
  return tenantIdStorage.run(tenantId, fn);
}

/** Returns the tenant id for the current async context, if any. */
export function getTenantId(): string | undefined {
  return tenantIdStorage.getStore();
}

/** Returns the tenant id for the current async context, or {@link DEFAULT_TENANT} when unset. */
export function getTenantIdOrDefault(): string {
  return getTenantId() ?? DEFAULT_TENANT;
}
