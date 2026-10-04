import { DEFAULT_TENANT } from '@forepath/shared/backend';
import { Injectable, OnModuleInit } from '@nestjs/common';

import { TENANTS_ALLOW_GLOBAL_VIEWS_ENV } from '../constants/tenants-global-views.constants';
import { parseCsvTenantIds } from '../utils/datev-format.util';

/**
 * Shared allowlist for admin global/cross-tenant views (DATEV unified export access
 * and File Explorer tenant tabs / unified consolidation).
 */
@Injectable()
export class TenantsGlobalViewsConfigService implements OnModuleInit {
  private allowedTenants: readonly string[] = [DEFAULT_TENANT];

  onModuleInit(): void {
    this.allowedTenants = parseCsvTenantIds(TENANTS_ALLOW_GLOBAL_VIEWS_ENV, [DEFAULT_TENANT]);
  }

  getAllowedTenants(): readonly string[] {
    return this.allowedTenants;
  }

  isGlobalViewsAllowedForTenant(tenantId: string): boolean {
    return this.allowedTenants.includes(tenantId);
  }
}
