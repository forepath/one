import { Injectable } from '@nestjs/common';
import { parseConfiguredTenants, isConfiguredTenant } from '@forepath/shared/backend';

import { resolveTenantFrontendBaseUrl } from '../utils/tenant-frontend-url.utils';

@Injectable()
export class BillingTenantService {
  getConfiguredTenants(): readonly string[] {
    return parseConfiguredTenants();
  }

  isValidTenant(tenantId: string): boolean {
    return isConfiguredTenant(tenantId, this.getConfiguredTenants());
  }

  getFrontendUrlForTenant(tenantId: string): string {
    return resolveTenantFrontendBaseUrl(tenantId);
  }
}
