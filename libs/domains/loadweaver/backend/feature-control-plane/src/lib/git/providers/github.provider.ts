import { githubMergeability, isFork } from '../plan-bot.utils';
import {
  GitProviderError,
  providerFailure,
  providerRequest,
  type BotComment,
  type BotReaction,
  type CommitStatusInput,
  type GitBotProvider,
  type GitProviderAdapter,
  type GitProviderContext,
  type Mergeability,
  type PullRequestInfo,
  type PullRequestInput,
  type PullRequestRef,
  type ReviewApproval,
  type ReviewApprovals,
} from './git-provider';

/** GitHub's GraphQL endpoint for an API base (`https://api.github.com`, GHES `https://host/api/v3`). */
export function githubGraphqlUrl(apiBase: string): string {
  const base = apiBase.replace(/\/+$/, '');

  return /\/api\/v3$/.test(base) ? base.replace(/\/v3$/, '/graphql') : `${base}/graphql`;
}

function repoPath(ctx: GitProviderContext): string {
  const [owner, repo, ...rest] = ctx.repo.split('/');

  if (!owner || !repo || rest.length > 0) throw new GitProviderError(0, `invalid repository ${ctx.repo}`);

  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/**
 * GitHub (and GitHub Enterprise) REST API: commit statuses, pull requests, the default branch. Gitea's API has the
 * same shapes, so `GiteaProvider` reuses this with its own base path and auth header.
 */
export class GithubProvider implements GitProviderAdapter, GitBotProvider {
  readonly kind: 'github' | 'gitea' = 'github';
  readonly hasApi = true;

  protected headers(ctx: GitProviderContext): Record<string, string> {
    return {
      ...(ctx.token ? { authorization: `Bearer ${ctx.token}` } : {}),
      'x-github-api-version': '2022-11-28',
    };
  }

  async setCommitStatus(ctx: GitProviderContext, input: CommitStatusInput): Promise<void> {
    const res = await providerRequest(
      ctx,
      'POST',
      `${ctx.apiBase}/repos/${repoPath(ctx)}/statuses/${encodeURIComponent(input.sha)}`,
      this.headers(ctx),
      {
        state: input.state,
        description: input.description.slice(0, 140),
        context: input.context,
        ...(input.targetUrl ? { target_url: input.targetUrl } : {}),
      },
    );

    if (res.status < 200 || res.status >= 300) throw providerFailure('commit status', res);
  }

  async createPullRequest(ctx: GitProviderContext, input: PullRequestInput): Promise<PullRequestRef | null> {
    const res = await providerRequest(ctx, 'POST', `${ctx.apiBase}/repos/${repoPath(ctx)}/pulls`, this.headers(ctx), {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
    });

    if (res.status >= 200 && res.status < 300)
      return { number: Number(res.json.number), url: String(res.json.html_url) };

    // One open PR per branch: reuse it.
    if (res.status === 409 || res.status === 422) {
      const existing = await this.findOpen(ctx, input.head);

      if (existing) return existing;
    }

    throw providerFailure('pull request', res);
  }

  protected async findOpen(ctx: GitProviderContext, head: string): Promise<PullRequestRef | null> {
    const res = await providerRequest(
      ctx,
      'GET',
      `${ctx.apiBase}/repos/${repoPath(ctx)}/pulls?state=open&per_page=50`,
      this.headers(ctx),
    );

    if (res.status !== 200 || !Array.isArray(res.json)) return null;

    const pr = (res.json as { number: number; html_url: string; head?: { ref?: string } }[]).find(
      (p) => p.head?.ref === head,
    );

    return pr ? { number: Number(pr.number), url: String(pr.html_url) } : null;
  }

  async getDefaultBranch(ctx: GitProviderContext): Promise<string | null> {
    const res = await providerRequest(ctx, 'GET', `${ctx.apiBase}/repos/${repoPath(ctx)}`, this.headers(ctx));

    if (res.status !== 200) throw providerFailure('repository', res);

    return typeof res.json?.default_branch === 'string' ? res.json.default_branch : null;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Plan bot (3.30)
  // -------------------------------------------------------------------------------------------------------------

  private repo(ctx: GitProviderContext): string {
    return `${ctx.apiBase}/repos/${repoPath(ctx)}`;
  }

  pullRequestRef(number: number): string {
    return `refs/pull/${number}/head`;
  }

  async getPullRequest(ctx: GitProviderContext, number: number): Promise<PullRequestInfo> {
    const res = await providerRequest(ctx, 'GET', `${this.repo(ctx)}/pulls/${number}`, this.headers(ctx));

    if (res.status !== 200) throw providerFailure(`pull request #${number}`, res);

    const pr = res.json;

    return {
      number: Number(pr.number),
      state: pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed',
      draft: pr.draft === true,
      title: String(pr.title ?? '').slice(0, 300),
      url: String(pr.html_url ?? ''),
      author: typeof pr.user?.login === 'string' ? pr.user.login : null,
      authorId: typeof pr.user?.id === 'number' || typeof pr.user?.id === 'string' ? String(pr.user.id) : null,
      headSha: String(pr.head?.sha ?? ''),
      headRef: String(pr.head?.ref ?? ''),
      baseRef: String(pr.base?.ref ?? ''),
      fork: isFork(pr.head?.repo?.full_name, pr.base?.repo?.full_name),
    };
  }

  async createComment(ctx: GitProviderContext, number: number, body: string): Promise<string> {
    const res = await providerRequest(ctx, 'POST', `${this.repo(ctx)}/issues/${number}/comments`, this.headers(ctx), {
      body,
    });

    if (res.status !== 201) throw providerFailure('comment', res);

    return String(res.json.id);
  }

  async updateComment(ctx: GitProviderContext, _number: number, id: string, body: string): Promise<boolean> {
    const res = await providerRequest(
      ctx,
      'PATCH',
      `${this.repo(ctx)}/issues/comments/${encodeURIComponent(id)}`,
      this.headers(ctx),
      { body },
    );

    if (res.status === 404) return false;

    if (res.status !== 200) throw providerFailure('comment update', res);

    return true;
  }

  async findComment(ctx: GitProviderContext, number: number, marker: string): Promise<string | null> {
    const res = await providerRequest(
      ctx,
      'GET',
      `${this.repo(ctx)}/issues/${number}/comments?per_page=100`,
      this.headers(ctx),
    );

    if (res.status !== 200 || !Array.isArray(res.json)) return null;

    const found = (res.json as { id: number; body?: string }[]).filter((c) => c.body?.includes(marker)).at(-1);

    return found ? String(found.id) : null;
  }

  async getComment(ctx: GitProviderContext, number: number, commentId: string): Promise<BotComment | null> {
    if (!/^\d{1,20}$/.test(commentId)) return null;

    const res = await providerRequest(ctx, 'GET', `${this.repo(ctx)}/issues/comments/${commentId}`, this.headers(ctx));

    if (res.status === 404) return null;

    if (res.status !== 200) throw providerFailure('comment', res);

    const c = res.json;
    const createdAt = new Date(String(c?.created_at ?? ''));

    // The comment must belong to this pull request (`issue_url` ends with `/issues/<number>`).
    if (!String(c?.issue_url ?? '').endsWith(`/issues/${number}`) || Number.isNaN(createdAt.getTime())) return null;

    return {
      id: String(c.id),
      body: String(c.body ?? ''),
      userId: String(c.user?.id ?? ''),
      login: String(c.user?.login ?? ''),
      isBot: c.user?.type === 'Bot',
      createdAt,
    };
  }

  async react(ctx: GitProviderContext, _number: number, commentId: string, reaction: BotReaction): Promise<void> {
    const res = await providerRequest(
      ctx,
      'POST',
      `${this.repo(ctx)}/issues/comments/${encodeURIComponent(commentId)}/reactions`,
      this.headers(ctx),
      { content: reaction },
    );

    if (res.status !== 200 && res.status !== 201) throw providerFailure('reaction', res);
  }

  async mergeability(ctx: GitProviderContext, pr: PullRequestInfo, ownContext: string): Promise<Mergeability> {
    const res = await providerRequest(ctx, 'GET', `${this.repo(ctx)}/pulls/${pr.number}`, this.headers(ctx));

    if (res.status !== 200) throw providerFailure(`pull request #${pr.number}`, res);

    const sha = encodeURIComponent(String(res.json.head?.sha ?? pr.headSha));
    const combined = await providerRequest(ctx, 'GET', `${this.repo(ctx)}/commits/${sha}/status`, this.headers(ctx));

    if (combined.status !== 200) throw providerFailure('commit statuses', combined);

    // Check runs need the `checks` permission; without it only statuses count.
    const runs = await providerRequest(
      ctx,
      'GET',
      `${this.repo(ctx)}/commits/${sha}/check-runs?per_page=100`,
      this.headers(ctx),
    );

    return githubMergeability(
      res.json,
      Array.isArray(combined.json?.statuses) ? combined.json.statuses : [],
      runs.status === 200 && Array.isArray(runs.json?.check_runs) ? runs.json.check_runs : [],
      ownContext,
      await this.reviewDecision(ctx, pr.number),
    );
  }

  /**
   * The pull request's review decision (branch protection's required reviews / code owners): `APPROVED`,
   * `REVIEW_REQUIRED`, `CHANGES_REQUESTED`, null when no review is required; `unknown` if GitHub didn't say.
   */
  protected async reviewDecision(ctx: GitProviderContext, number: number): Promise<string | null> {
    const [owner, name] = ctx.repo.split('/');
    const res = await providerRequest(ctx, 'POST', githubGraphqlUrl(ctx.apiBase), this.headers(ctx), {
      query:
        'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewDecision } } }',
      variables: { owner, name, number },
    });
    const pull = res.status === 200 ? res.json?.data?.repository?.pullRequest : undefined;

    if (!pull || typeof pull !== 'object' || (res.json?.errors && !res.json?.data)) return 'unknown';

    return typeof pull.reviewDecision === 'string' ? pull.reviewDecision : null;
  }

  async approvals(ctx: GitProviderContext, pr: PullRequestInfo): Promise<ReviewApprovals> {
    const res = await providerRequest(
      ctx,
      'GET',
      `${this.repo(ctx)}/pulls/${pr.number}/reviews?per_page=100`,
      this.headers(ctx),
    );

    if (res.status !== 200 || !Array.isArray(res.json)) throw providerFailure('reviews', res);

    // The newest decisive review per reviewer counts, and only if it is on the current head.
    const latest = new Map<string, { state: string; commit_id?: string; login: string }>();

    for (const review of res.json as { user?: { id?: number; login?: string }; state?: string; commit_id?: string }[]) {
      if (!review.user?.id || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state ?? '')) continue;

      latest.set(String(review.user.id), {
        state: review.state as string,
        commit_id: review.commit_id,
        login: review.user.login ?? '',
      });
    }

    const approvals: ReviewApproval[] = [...latest.entries()]
      .filter(([, r]) => r.state === 'APPROVED' && r.commit_id === pr.headSha)
      .map(([userId, r]) => ({ userId, login: r.login }));

    return { approvals, ignored: null };
  }

  async merge(ctx: GitProviderContext, number: number, sha: string, title: string): Promise<void> {
    const res = await providerRequest(ctx, 'PUT', `${this.repo(ctx)}/pulls/${number}/merge`, this.headers(ctx), {
      sha,
      merge_method: 'merge',
      commit_title: title.slice(0, 250),
    });

    if (res.status !== 200 || res.json?.merged === false) throw providerFailure('merge', res);
  }
}
