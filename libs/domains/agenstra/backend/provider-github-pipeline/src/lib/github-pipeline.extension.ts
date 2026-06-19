import { DynamicModule, Module, Type } from '@nestjs/common';

import type { PipelineProvider } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { GithubPipelineProvider } from './github-pipeline.provider';

@Module({
  providers: [GithubPipelineProvider],
  exports: [GithubPipelineProvider],
})
class GithubPipelineExtensionModule {}

export function createGithubPipelineExtension(): ForepathExtension<PipelineProvider> {
  return {
    register(): DynamicModule {
      return {
        module: GithubPipelineExtensionModule,
        providers: [GithubPipelineProvider],
        exports: [GithubPipelineProvider],
      };
    },
    getInstanceToken(): Type<PipelineProvider> {
      return GithubPipelineProvider;
    },
  };
}
