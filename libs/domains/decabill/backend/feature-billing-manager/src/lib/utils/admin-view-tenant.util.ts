import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { ForbiddenException } from '@nestjs/common';

import type { TenantsGlobalViewsConfigService } from '../services/tenants-global-views-config.service';

/**
 * Resolves the tenant used for admin list/download when operators may switch tabs.
 * Foreign `viewTenantId` is only accepted when the request tenant is on TENANTS_ALLOW_GLOBAL_VIEWS.
 */
export function resolveAdminViewTenant(
  globalViewsConfig: TenantsGlobalViewsConfigService,
  viewTenantId?: string | null,
): string {
  const requestTenantId = getTenantIdOrDefault();
  const requested = viewTenantId?.trim();

  if (!requested || requested === requestTenantId) {
    return requestTenantId;
  }

  if (!globalViewsConfig.isGlobalViewsAllowedForTenant(requestTenantId)) {
    throw new ForbiddenException('Cross-tenant admin views are not allowed for this tenant');
  }

  return requested;
}
