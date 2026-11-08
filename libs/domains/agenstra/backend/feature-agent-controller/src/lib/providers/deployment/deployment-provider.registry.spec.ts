import { BadRequestException } from '@nestjs/common';

import { DeploymentProviderRegistry } from './deployment-provider.registry';
import { GitHubDeploymentProvider } from './github-deployment.provider';
import { GitLabDeploymentProvider } from './gitlab-deployment.provider';
import { JenkinsDeploymentProvider } from './jenkins-deployment.provider';

describe('DeploymentProviderRegistry', () => {
  const github = new GitHubDeploymentProvider();
  const gitlab = new GitLabDeploymentProvider();
  const jenkins = new JenkinsDeploymentProvider();
  const registry = new DeploymentProviderRegistry(github, gitlab, jenkins);

  it('returns the adapter per provider', () => {
    expect(registry.get('github')).toBe(github);
    expect(registry.get('gitlab')).toBe(gitlab);
    expect(registry.get('jenkins')).toBe(jenkins);
    expect(registry.list()).toHaveLength(3);
  });

  it('rejects unknown providers', () => {
    expect(() => registry.get('bitbucket')).toThrow(BadRequestException);
  });
});
