import type { GitProviderContext } from './git-provider';
import { GithubProvider } from './github.provider';

/**
 * Gitea / Forgejo API (`/api/v1`): the same repository, status and pull request shapes as GitHub; tokens are sent
 * as `Authorization: token <token>`.
 */
export class GiteaProvider extends GithubProvider {
  override readonly kind = 'gitea' as const;

  protected override headers(ctx: GitProviderContext): Record<string, string> {
    return ctx.token ? { authorization: `token ${ctx.token}` } : {};
  }
}
