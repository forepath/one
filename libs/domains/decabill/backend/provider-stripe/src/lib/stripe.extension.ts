import { DynamicModule, Module, Type } from '@nestjs/common';

import type { PaymentProcessor } from '@forepath/decabill/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { StripeProvider } from './stripe.provider';

@Module({
  providers: [StripeProvider],
  exports: [StripeProvider],
})
class StripeExtensionModule {}

export function createStripeExtension(): ForepathExtension<PaymentProcessor> {
  return {
    register(): DynamicModule {
      return {
        module: StripeExtensionModule,
        providers: [StripeProvider],
        exports: [StripeProvider],
      };
    },
    getInstanceToken(): Type<PaymentProcessor> {
      return StripeProvider;
    },
  };
}
