import { gitlabMergeability, isFork } from '../plan-bot.utils';
import {
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
  type ReviewApprovals,
} from './git-provider';

const GITLAB_EMOJI: Record<BotReaction, string> = {
  eyes: 'eyes',
  '+1': 'thumbsup',
  '-1': 'thumbsdown',
  rocket: 'rocket',
  confused: 'confused',
};

const GITLAB_STATES = { pending: 'pending', success: 'success', failure: 'failed', error: 'canceled' } as const;

/** GitLab (gitlab.com and self-managed) REST API v4: commit statuses, merge requests, the default branch. */
export class GitlabProvider implements GitProviderAdapter, GitBotProvider {
  readonly kind = 'gitlab' as const;
  readonly hasApi = true;

  private headers(ctx: GitProviderContext): Record<string, string> {
    return ctx.token ? { 'private-token': ctx.token } : {};
  }

  private project(ctx: GitProviderContext): string {
    return `${ctx.apiBase}/projects/${encodeURIComponent(ctx.repo)}`;
  }

  async setCommitStatus(ctx: GitProviderContext, input: CommitStatusInput): Promise<void> {
    const res = await providerRequest(
      ctx,
      'POST',
      `${this.project(ctx)}/statuses/${encodeURIComponent(input.sha)}`,
      this.headers(ctx),
      {
        state: GITLAB_STATES[input.state],
        name: input.context,
        description: input.description.slice(0, 255),
        ...(input.targetUrl ? { target_url: input.targetUrl } : {}),
      },
    );

    // Re-reporting the same state is refused as a transition; the status is already what we want.
    if (res.status === 400 && /Cannot transition status/i.test(JSON.stringify(res.json ?? ''))) return;

    if (res.status < 200 || res.status >= 300) throw providerFailure('commit status', res);
  }

  async createPullRequest(ctx: GitProviderContext, input: PullRequestInput): Promise<PullRequestRef | null> {
    const res = await providerRequest(ctx, 'POST', `${this.project(ctx)}/merge_requests`, this.headers(ctx), {
      source_branch: input.head,
      target_branch: input.base,
      title: input.title,
      description: input.body,
      remove_source_branch: true,
    });

    if (res.status >= 200 && res.status < 300) return { number: Number(res.json.iid), url: String(res.json.web_url) };

    if (res.status === 409) {
      const open = await providerRequest(
        ctx,
        'GET',
        `${this.project(ctx)}/merge_requests?state=opened&source_branch=${encodeURIComponent(input.head)}`,
        this.headers(ctx),
      );
      const mr = Array.isArray(open.json) ? (open.json[0] as { iid: number; web_url: string } | undefined) : undefined;

      if (mr) return { number: Number(mr.iid), url: String(mr.web_url) };
    }

    throw providerFailure('merge request', res);
  }

  async getDefaultBranch(ctx: GitProviderContext): Promise<string | null> {
    const res = await providerRequest(ctx, 'GET', this.project(ctx), this.headers(ctx));

    if (res.status !== 200) throw providerFailure('project', res);

    return typeof res.json?.default_branch === 'string' ? res.json.default_branch : null;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Plan bot (3.30)
  // -------------------------------------------------------------------------------------------------------------

  pullRequestRef(number: number): string {
    return `refs/merge-requests/${number}/head`;
  }

  private mr(ctx: GitProviderContext, number: number): string {
    return `${this.project(ctx)}/merge_requests/${number}`;
  }

  async getPullRequest(ctx: GitProviderContext, number: number): Promise<PullRequestInfo> {
    const res = await providerRequest(ctx, 'GET', this.mr(ctx, number), this.headers(ctx));

    if (res.status !== 200) throw providerFailure(`merge request !${number}`, res);

    const mr = res.json;

    return {
      number: Number(mr.iid),
      state: mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed',
      draft: mr.draft === true || mr.work_in_progress === true,
      title: String(mr.title ?? '').slice(0, 300),
      url: String(mr.web_url ?? ''),
      author: typeof mr.author?.username === 'string' ? mr.author.username : null,
      authorId: typeof mr.author?.id === 'number' || typeof mr.author?.id === 'string' ? String(mr.author.id) : null,
      headSha: String(mr.sha ?? mr.diff_refs?.head_sha ?? ''),
      headRef: String(mr.source_branch ?? ''),
      baseRef: String(mr.target_branch ?? ''),
      fork: isFork(mr.source_project_id, mr.target_project_id),
    };
  }

  async createComment(ctx: GitProviderContext, number: number, body: string): Promise<string> {
    const res = await providerRequest(ctx, 'POST', `${this.mr(ctx, number)}/notes`, this.headers(ctx), { body });

    if (res.status !== 201) throw providerFailure('note', res);

    return String(res.json.id);
  }

  async updateComment(ctx: GitProviderContext, number: number, id: string, body: string): Promise<boolean> {
    const res = await providerRequest(
      ctx,
      'PUT',
      `${this.mr(ctx, number)}/notes/${encodeURIComponent(id)}`,
      this.headers(ctx),
      { body },
    );

    if (res.status === 404) return false;

    if (res.status !== 200) throw providerFailure('note update', res);

    return true;
  }

  async findComment(ctx: GitProviderContext, number: number, marker: string): Promise<string | null> {
    const res = await providerRequest(
      ctx,
      'GET',
      `${this.mr(ctx, number)}/notes?per_page=100&sort=asc&order_by=created_at`,
      this.headers(ctx),
    );

    if (res.status !== 200 || !Array.isArray(res.json)) return null;

    const found = (res.json as { id: number; body?: string }[]).filter((n) => n.body?.includes(marker)).at(-1);

    return found ? String(found.id) : null;
  }

  async getComment(ctx: GitProviderContext, number: number, commentId: string): Promise<BotComment | null> {
    if (!/^\d{1,20}$/.test(commentId)) return null;

    const res = await providerRequest(ctx, 'GET', `${this.mr(ctx, number)}/notes/${commentId}`, this.headers(ctx));

    if (res.status === 404) return null;

    if (res.status !== 200) throw providerFailure('note', res);

    const n = res.json;
    const createdAt = new Date(String(n?.created_at ?? ''));

    if (
      n?.system === true ||
      (n?.noteable_iid !== undefined && Number(n.noteable_iid) !== number) ||
      Number.isNaN(createdAt.getTime())
    )
      return null;

    return {
      id: String(n.id),
      body: String(n.body ?? ''),
      userId: String(n.author?.id ?? ''),
      login: String(n.author?.username ?? ''),
      isBot: n.author?.bot === true,
      createdAt,
    };
  }

  async react(ctx: GitProviderContext, number: number, commentId: string, reaction: BotReaction): Promise<void> {
    const res = await providerRequest(
      ctx,
      'POST',
      `${this.mr(ctx, number)}/notes/${encodeURIComponent(commentId)}/award_emoji`,
      this.headers(ctx),
      { name: GITLAB_EMOJI[reaction] },
    );

    if (res.status !== 201 && res.status !== 200) throw providerFailure('award emoji', res);
  }

  async mergeability(ctx: GitProviderContext, pr: PullRequestInfo, ownContext: string): Promise<Mergeability> {
    const res = await providerRequest(ctx, 'GET', this.mr(ctx, pr.number), this.headers(ctx));

    if (res.status !== 200) throw providerFailure(`merge request !${pr.number}`, res);

    const sha = encodeURIComponent(String(res.json.sha ?? pr.headSha));
    const statuses = await providerRequest(
      ctx,
      'GET',
      `${this.project(ctx)}/repository/commits/${sha}/statuses?per_page=100&all=true`,
      this.headers(ctx),
    );

    if (statuses.status !== 200) throw providerFailure('commit statuses', statuses);

    return gitlabMergeability(res.json, Array.isArray(statuses.json) ? statuses.json : [], ownContext);
  }

  /**
   * MR approvals that belong to the current head (3.30): GitLab keeps approvals across pushes unless the project
   * resets them, so they only count if `reset_approvals_on_push` is on, or the approval (its system note) came after
   * the head was pushed (the MR version of that head). Otherwise they are ignored, with the reason.
   */
  async approvals(ctx: GitProviderContext, pr: PullRequestInfo): Promise<ReviewApprovals> {
    const res = await providerRequest(ctx, 'GET', `${this.mr(ctx, pr.number)}/approvals`, this.headers(ctx));

    if (res.status !== 200) throw providerFailure('approvals', res);

    const given = ((res.json?.approved_by ?? []) as { user?: { id?: number; username?: string } }[]).flatMap((a) =>
      a.user?.id ? [{ userId: String(a.user.id), login: a.user.username ?? '' }] : [],
    );

    if (given.length === 0) return { approvals: [], ignored: null };

    const settings = await providerRequest(ctx, 'GET', `${this.project(ctx)}/approvals`, this.headers(ctx));

    if (settings.status === 200 && settings.json?.reset_approvals_on_push === true)
      return { approvals: given, ignored: null };

    const versions = await providerRequest(
      ctx,
      'GET',
      `${this.mr(ctx, pr.number)}/versions?per_page=100`,
      this.headers(ctx),
    );
    const version = Array.isArray(versions.json)
      ? (versions.json as { head_commit_sha?: string; created_at?: string }[]).find(
          (v) => v.head_commit_sha === pr.headSha,
        )
      : undefined;
    const headAt = version?.created_at ? Date.parse(version.created_at) : Number.NaN;
    const notes = await providerRequest(
      ctx,
      'GET',
      `${this.mr(ctx, pr.number)}/notes?per_page=100&sort=desc&order_by=created_at`,
      this.headers(ctx),
    );
    // The newest approve / unapprove system note per user.
    const latest = new Map<string, { approved: boolean; at: number }>();

    for (const note of Array.isArray(notes.json)
      ? (notes.json as { system?: boolean; body?: string; author?: { id?: number }; created_at?: string }[])
      : []) {
      const body = String(note.body ?? '').trim();
      const user = note.author?.id !== undefined ? String(note.author.id) : null;

      if (!note.system || !user || latest.has(user) || !/^(?:un)?approved this merge request$/.test(body)) continue;

      latest.set(user, { approved: !body.startsWith('un'), at: Date.parse(String(note.created_at ?? '')) });
    }

    const approvals = Number.isNaN(headAt)
      ? []
      : given.filter((a) => {
          const note = latest.get(a.userId);

          return !!note && note.approved && note.at >= headAt;
        });
    const stale = given.length - approvals.length;

    return {
      approvals,
      ignored:
        stale > 0
          ? `${stale} GitLab approval(s) ignored: they were given before the current head was pushed (or that can't be told), and the project doesn't reset approvals on push`
          : null,
    };
  }

  async merge(ctx: GitProviderContext, number: number, sha: string, title: string): Promise<void> {
    const res = await providerRequest(ctx, 'PUT', `${this.mr(ctx, number)}/merge`, this.headers(ctx), {
      sha,
      merge_commit_message: title.slice(0, 250),
    });

    if (res.status !== 200) throw providerFailure('merge', res);
  }
}
