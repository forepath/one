import { DynamicModule, Module, Type } from '@nestjs/common';

import type { ProvisioningProvider } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { DigitalOceanProvisioningProvider } from './digital-ocean-provisioning.provider';

@Module({
  providers: [DigitalOceanProvisioningProvider],
  exports: [DigitalOceanProvisioningProvider],
})
class DigitalOceanProvisioningExtensionModule {}

export function createDigitalOceanProvisioningExtension(): ForepathExtension<ProvisioningProvider> {
  return {
    register(): DynamicModule {
      return {
        module: DigitalOceanProvisioningExtensionModule,
        providers: [DigitalOceanProvisioningProvider],
        exports: [DigitalOceanProvisioningProvider],
      };
    },
    getInstanceToken(): Type<ProvisioningProvider> {
      return DigitalOceanProvisioningProvider;
    },
  };
}
