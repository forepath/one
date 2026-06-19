import { DynamicModule, Module, Type } from '@nestjs/common';

import type { ProvisioningProvider } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { HetznerProvisioningProvider } from './hetzner-provisioning.provider';

@Module({
  providers: [HetznerProvisioningProvider],
  exports: [HetznerProvisioningProvider],
})
class HetznerProvisioningExtensionModule {}

export function createHetznerProvisioningExtension(): ForepathExtension<ProvisioningProvider> {
  return {
    register(): DynamicModule {
      return {
        module: HetznerProvisioningExtensionModule,
        providers: [HetznerProvisioningProvider],
        exports: [HetznerProvisioningProvider],
      };
    },
    getInstanceToken(): Type<ProvisioningProvider> {
      return HetznerProvisioningProvider;
    },
  };
}
