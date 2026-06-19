import { DynamicModule, Module, Type } from '@nestjs/common';

import type { EmbeddingProvider } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { LocalEmbeddingProvider } from './local-embedding.provider';

@Module({
  providers: [LocalEmbeddingProvider],
  exports: [LocalEmbeddingProvider],
})
class LocalEmbeddingExtensionModule {}

export function createLocalEmbeddingExtension(): ForepathExtension<EmbeddingProvider> {
  return {
    register(): DynamicModule {
      return {
        module: LocalEmbeddingExtensionModule,
        providers: [LocalEmbeddingProvider],
        exports: [LocalEmbeddingProvider],
      };
    },
    getInstanceToken(): Type<EmbeddingProvider> {
      return LocalEmbeddingProvider;
    },
  };
}
