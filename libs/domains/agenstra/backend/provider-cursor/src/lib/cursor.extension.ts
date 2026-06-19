import { DynamicModule, Module, Type } from '@nestjs/common';

import type { AgentProvider } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { CursorProvider } from './cursor.provider';

@Module({
  providers: [CursorProvider],
  exports: [CursorProvider],
})
class CursorExtensionModule {}

export function createCursorExtension(): ForepathExtension<AgentProvider> {
  return {
    register(): DynamicModule {
      return {
        module: CursorExtensionModule,
        providers: [CursorProvider],
        exports: [CursorProvider],
      };
    },
    getInstanceToken(): Type<AgentProvider> {
      return CursorProvider;
    },
  };
}
