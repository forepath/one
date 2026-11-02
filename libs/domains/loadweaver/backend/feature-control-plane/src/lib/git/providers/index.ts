import type { GitProviderKind } from '../../entities/git.entity';
import { PlainGitProvider, type GitBotProvider, type GitProviderAdapter } from './git-provider';
import { GiteaProvider } from './gitea.provider';
import { GithubProvider } from './github.provider';
import { GitlabProvider } from './gitlab.provider';

export * from './git-provider';
export { GiteaProvider } from './gitea.provider';
export { GithubProvider } from './github.provider';
export { GitlabProvider } from './gitlab.provider';

const ADAPTERS: Record<GitProviderKind, GitProviderAdapter> = {
  github: new GithubProvider(),
  gitlab: new GitlabProvider(),
  gitea: new GiteaProvider(),
  git: new PlainGitProvider(),
};

export function providerAdapter(kind: GitProviderKind): GitProviderAdapter {
  return ADAPTERS[kind];
}

const BOTS: Partial<Record<GitProviderKind, GitBotProvider>> = {
  github: ADAPTERS.github as GithubProvider,
  gitlab: ADAPTERS.gitlab as GitlabProvider,
};

/** The plan bot's provider (GitHub, GitLab); Gitea / Forgejo and plain Git keep the commit-status flow (3.30). */
export function botAdapter(kind: GitProviderKind): GitBotProvider | null {
  return BOTS[kind] ?? null;
}
