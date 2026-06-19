import { Inject, Injectable } from '@nestjs/common';

import type { BillingProvisioningProvider } from '@forepath/decabill/backend/util-plugin-host';
import { BILLING_PROVISIONING_PROVIDER_REGISTRY } from '@forepath/decabill/backend/util-plugin-host';
import { ProviderRegistry } from '@forepath/shared/backend/util-extension-core';

import { ServerTypeDto } from '../dto/server-type.dto';

/**
 * Fetches server types with pricing from provisioning providers.
 * Used by the billing console to show server type dropdowns with price and to auto-set base price.
 */
@Injectable()
export class ProviderServerTypesService {
  constructor(
    @Inject(BILLING_PROVISIONING_PROVIDER_REGISTRY)
    private readonly provisioningRegistry: ProviderRegistry<BillingProvisioningProvider>,
  ) {}

  async getServerTypes(providerId: string): Promise<ServerTypeDto[]> {
    if (!this.provisioningRegistry.hasProvider(providerId)) {
      return [];
    }

    return await this.provisioningRegistry.getProvider(providerId).getServerTypes();
  }
}
