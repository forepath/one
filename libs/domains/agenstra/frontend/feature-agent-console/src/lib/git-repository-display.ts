import type { AgentResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';
import type {
  ConfigResponseDto,
  WorkspaceConfigurationSettingResponseDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';

export type GitRepositorySetupMode = 'clone' | 'empty';

/**
 * Effective git setup mode: per-environment first, then workspace configuration override, then instance config.
 */
export function resolveGitRepositorySetupMode(
  agent?: Pick<AgentResponseDto, 'git'> | null,
  clientConfig?: ConfigResponseDto | null,
  workspaceSettings?: WorkspaceConfigurationSettingResponseDto[] | null,
): GitRepositorySetupMode {
  if (agent?.git?.setupMode === 'empty' || agent?.git?.setupMode === 'clone') {
    return agent.git.setupMode;
  }

  const modeSetting = workspaceSettings?.find((entry) => entry.settingKey === 'gitRepositorySetupMode');

  if (modeSetting?.value === 'empty' || modeSetting?.value === 'clone') {
    return modeSetting.value;
  }

  if (clientConfig?.gitRepositorySetupMode === 'empty') {
    return 'empty';
  }

  return 'clone';
}

export function parseGitRepository(gitUrl: string | null | undefined): string | null {
  if (!gitUrl) {
    return null;
  }

  try {
    if (gitUrl.startsWith('http://') || gitUrl.startsWith('https://')) {
      const urlObj = new URL(gitUrl);
      const pathParts = urlObj.pathname.split('/').filter((part) => part.length > 0);

      if (pathParts.length >= 2) {
        const owner = pathParts[0];
        const repo = pathParts[1].replace(/\.git$/, '');

        return `${owner}/${repo}`;
      }
    }

    if (gitUrl.startsWith('git@')) {
      const match = gitUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);

      if (match?.[1]) {
        return match[1];
      }
    }

    const fallback = gitUrl.match(/(?:[/:])([^/]+)\/([^/]+?)(?:\.git)?$/);

    if (fallback?.[1] && fallback[2]) {
      return `${fallback[1]}/${fallback[2]}`;
    }
  } catch {
    return null;
  }

  return null;
}

/** Owner/repo label for badges; null when setup mode is empty or URL is missing. */
export function getGitRepositoryDisplayLabel(
  agent?: Pick<AgentResponseDto, 'git'> | null,
  clientConfig?: ConfigResponseDto | null,
  workspaceSettings?: WorkspaceConfigurationSettingResponseDto[] | null,
): string | null {
  if (resolveGitRepositorySetupMode(agent, clientConfig, workspaceSettings) === 'empty') {
    return null;
  }

  const url = agent?.git?.repositoryUrl ?? clientConfig?.gitRepositoryUrl ?? undefined;

  return parseGitRepository(url ?? undefined);
}

export function isLocalGitRepository(
  agent?: Pick<AgentResponseDto, 'git'> | null,
  clientConfig?: ConfigResponseDto | null,
  workspaceSettings?: WorkspaceConfigurationSettingResponseDto[] | null,
): boolean {
  return resolveGitRepositorySetupMode(agent, clientConfig, workspaceSettings) === 'empty';
}
