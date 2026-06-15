import { Injectable } from '@nestjs/common';

import { GitRepositorySetupMode, resolveGitRepositorySetupMode } from '../constants/git-repository-setup-mode';
import { AgentProviderFactory } from '../providers/agent-provider.factory';

/**
 * Service for retrieving configuration parameters.
 * Provides access to environment-based configuration values.
 */
@Injectable()
export class ConfigService {
  constructor(private readonly agentProviderFactory: AgentProviderFactory) {}

  /**
   * Get the Git repository URL from environment variables.
   * @returns The Git repository URL, or undefined if not set
   */
  getGitRepositoryUrl(): string | undefined {
    return process.env.GIT_REPOSITORY_URL;
  }

  /**
   * Get the Git repository setup mode from environment variables.
   * @returns Resolved setup mode (defaults to clone when unset)
   */
  getGitRepositorySetupMode(): GitRepositorySetupMode {
    return resolveGitRepositorySetupMode(undefined, process.env.GIT_REPOSITORY_SETUP_MODE);
  }

  /**
   * Get the list of available agent provider types with display names.
   * @returns Array of agent type information objects
   */
  getAvailableAgentTypes(): Array<{ type: string; displayName: string }> {
    return this.agentProviderFactory.getRegisteredTypes().map((type) => {
      const provider = this.agentProviderFactory.getProvider(type);

      return {
        type: provider.getType(),
        displayName: provider.getDisplayName(),
      };
    });
  }
}
