import { DynamicModule, Module, Type } from '@nestjs/common';

import type { ExternalContextImportProvider } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { AtlassianImportProvider } from './atlassian-import.provider';

@Module({
  providers: [AtlassianImportProvider],
  exports: [AtlassianImportProvider],
})
class AtlassianImportExtensionModule {}

export function createAtlassianImportExtension(): ForepathExtension<ExternalContextImportProvider> {
  return {
    register(): DynamicModule {
      return {
        module: AtlassianImportExtensionModule,
        providers: [AtlassianImportProvider],
        exports: [AtlassianImportProvider],
      };
    },
    getInstanceToken(): Type<ExternalContextImportProvider> {
      return AtlassianImportProvider;
    },
  };
}
