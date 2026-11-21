import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { ForbiddenException } from '@nestjs/common';

import type { TenantsGlobalViewsConfigService } from '../../services/tenants-global-views-config.service';
import { resolveAdminViewTenant } from '../../utils/admin-view-tenant.util';

export interface AccountingViewScope {
  /** Tenant dimension filter for queries; `null` = all tenants. */
  tenantFilter: string | null;
  requestTenantId: string;
  /** Request tenant is on TENANTS_ALLOW_GLOBAL_VIEWS (entity-wide functions allowed). */
  global: boolean;
}

/**
 * Tenant scope of an accounting request (TENANTS_ALLOW_GLOBAL_VIEWS): the request tenant by default, another
 * tenant or `all` only for allowlisted tenants.
 */
export function resolveAccountingScope(
  globalViews: TenantsGlobalViewsConfigService,
  viewTenantId?: string | null,
): AccountingViewScope {
  const requestTenantId = getTenantIdOrDefault();
  const global = globalViews.isGlobalViewsAllowedForTenant(requestTenantId);
  const requested = viewTenantId?.trim();

  if (requested === 'all') {
    if (!global) {
      throw new ForbiddenException('Cross-tenant accounting views are not allowed for this tenant');
    }

    return { tenantFilter: null, requestTenantId, global };
  }

  return { tenantFilter: resolveAdminViewTenant(globalViews, requested), requestTenantId, global };
}

/** Entity-wide functions (chart, fiscal years, VAT returns, statements, full exports) need global access. */
export function assertGlobalAccounting(globalViews: TenantsGlobalViewsConfigService): AccountingViewScope {
  const scope = resolveAccountingScope(globalViews, 'all');

  return scope;
}
