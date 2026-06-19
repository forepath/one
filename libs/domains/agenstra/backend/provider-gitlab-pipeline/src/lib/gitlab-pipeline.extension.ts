import { DynamicModule, Module, Type } from '@nestjs/common';

import type { PipelineProvider } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { GitlabPipelineProvider } from './gitlab-pipeline.provider';

@Module({
  providers: [GitlabPipelineProvider],
  exports: [GitlabPipelineProvider],
})
class GitlabPipelineExtensionModule {}

export function createGitlabPipelineExtension(): ForepathExtension<PipelineProvider> {
  return {
    register(): DynamicModule {
      return {
        module: GitlabPipelineExtensionModule,
        providers: [GitlabPipelineProvider],
        exports: [GitlabPipelineProvider],
      };
    },
    getInstanceToken(): Type<PipelineProvider> {
      return GitlabPipelineProvider;
    },
  };
}
