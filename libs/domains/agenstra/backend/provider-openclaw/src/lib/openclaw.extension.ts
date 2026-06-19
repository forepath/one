import { DynamicModule, Module, Type } from '@nestjs/common';

import type { AgentProvider } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { OpenclawProvider } from './openclaw.provider';

@Module({
  providers: [OpenclawProvider],
  exports: [OpenclawProvider],
})
class OpenclawExtensionModule {}

export function createOpenclawExtension(): ForepathExtension<AgentProvider> {
  return {
    register(): DynamicModule {
      return {
        module: OpenclawExtensionModule,
        providers: [OpenclawProvider],
        exports: [OpenclawProvider],
      };
    },
    getInstanceToken(): Type<AgentProvider> {
      return OpenclawProvider;
    },
  };
}
