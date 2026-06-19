import { DynamicModule, Module, Type } from '@nestjs/common';

import type { BillingProvisioningProvider } from '@forepath/decabill/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { HetznerProvider } from './hetzner.provider';

@Module({
  providers: [HetznerProvider],
  exports: [HetznerProvider],
})
class HetznerExtensionModule {}

export function createHetznerExtension(): ForepathExtension<BillingProvisioningProvider> {
  return {
    register(): DynamicModule {
      return {
        module: HetznerExtensionModule,
        providers: [HetznerProvider],
        exports: [HetznerProvider],
      };
    },
    getInstanceToken(): Type<BillingProvisioningProvider> {
      return HetznerProvider;
    },
  };
}
