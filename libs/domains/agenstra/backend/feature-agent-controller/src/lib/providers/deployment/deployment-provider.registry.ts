import { isDeploymentProvider, type DeploymentProvider } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, Injectable } from '@nestjs/common';

import type { DeploymentPipelineProvider } from './deployment-provider.interface';
import { GitHubDeploymentProvider } from './github-deployment.provider';
import { GitLabDeploymentProvider } from './gitlab-deployment.provider';
import { JenkinsDeploymentProvider } from './jenkins-deployment.provider';

/** Resolves the CI/CD adapter of a deployment connection. */
@Injectable()
export class DeploymentProviderRegistry {
  private readonly providers: ReadonlyMap<DeploymentProvider, DeploymentPipelineProvider>;

  constructor(github: GitHubDeploymentProvider, gitlab: GitLabDeploymentProvider, jenkins: JenkinsDeploymentProvider) {
    this.providers = new Map<DeploymentProvider, DeploymentPipelineProvider>([
      [github.provider, github],
      [gitlab.provider, gitlab],
      [jenkins.provider, jenkins],
    ]);
  }

  get(provider: DeploymentProvider | string): DeploymentPipelineProvider {
    const adapter = isDeploymentProvider(provider) ? this.providers.get(provider) : undefined;

    if (!adapter) {
      throw new BadRequestException('Unsupported deployment provider');
    }

    return adapter;
  }

  list(): DeploymentPipelineProvider[] {
    return [...this.providers.values()];
  }
}
