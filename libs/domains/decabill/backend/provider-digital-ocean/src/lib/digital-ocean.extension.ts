import { DynamicModule, Module, Type } from '@nestjs/common';

import type { BillingProvisioningProvider } from '@forepath/decabill/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { DigitalOceanProvider } from './digital-ocean.provider';

@Module({
  providers: [DigitalOceanProvider],
  exports: [DigitalOceanProvider],
})
class DigitalOceanExtensionModule {}

export function createDigitalOceanExtension(): ForepathExtension<BillingProvisioningProvider> {
  return {
    register(): DynamicModule {
      return {
        module: DigitalOceanExtensionModule,
        providers: [DigitalOceanProvider],
        exports: [DigitalOceanProvider],
      };
    },
    getInstanceToken(): Type<BillingProvisioningProvider> {
      return DigitalOceanProvider;
    },
  };
}
