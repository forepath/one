import { DynamicModule, Module, Type } from '@nestjs/common';

import type { AgentProvider } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { OpencodeProvider } from './opencode.provider';

@Module({
  providers: [OpencodeProvider],
  exports: [OpencodeProvider],
})
class OpencodeExtensionModule {}

export function createOpencodeExtension(): ForepathExtension<AgentProvider> {
  return {
    register(): DynamicModule {
      return {
        module: OpencodeExtensionModule,
        providers: [OpencodeProvider],
        exports: [OpencodeProvider],
      };
    },
    getInstanceToken(): Type<AgentProvider> {
      return OpencodeProvider;
    },
  };
}
