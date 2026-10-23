import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

import type { GitAccountProvider } from '../entities/git.entity';
import { normalizeRepoDir } from './git-url.utils';
import type { Mergeability } from './providers/git-provider';

// ---------------------------------------------------------------------------------------------------------------
// Commands (3.30)
// ---------------------------------------------------------------------------------------------------------------

export const BOT_COMMANDS = ['plan', 'apply', 'unlock', 'approve', 'drift', 'help'] as const;
export type BotCommandName = (typeof BOT_COMMANDS)[number];

export type BotCommand =
  | { name: 'plan'; project?: string; path?: string }
  | { name: 'apply'; confirm: boolean }
  | { name: 'unlock' | 'approve' | 'drift' | 'help' }
  | { name: 'invalid'; reason: string };

const PROJECT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A command in a comment: the first non-empty line starts with `loadweaver` (case-insensitive). Anything else is
 * no command (null), so normal discussion never triggers the bot.
 */
export function parseBotCommand(body: string): BotCommand | null {
  const line = (body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  if (!line) return null;

  const words = line.split(/\s+/);

  if (words[0].toLowerCase() !== 'loadweaver') return null;

  const name = (words[1] ?? '').toLowerCase();
  const args = words.slice(2);

  switch (name) {
    case 'plan': {
      if (args.length === 0) return { name: 'plan' };

      if (args.length > 1) return { name: 'invalid', reason: '`loadweaver plan` takes at most one project or path' };

      const target = args[0];

      if (PROJECT.test(target)) return { name: 'plan', project: target };

      try {
        const path = normalizeRepoDir(target.replace(/\/+$/, ''));

        if (path) return { name: 'plan', path };
      } catch {
        // falls through
      }

      return { name: 'invalid', reason: `\`${target.slice(0, 80)}\` is neither a project nor a path` };
    }
    case 'apply': {
      const unknown = args.filter((a) => a !== '--confirm');

      if (unknown.length > 0)
        return { name: 'invalid', reason: '`loadweaver apply` only takes `--confirm` (to apply unacknowledged pins)' };

      return { name: 'apply', confirm: args.includes('--confirm') };
    }
    case 'unlock':
    case 'approve':
    case 'drift':
    case 'help':
      return args.length > 0 ? { name: 'invalid', reason: `\`loadweaver ${name}\` takes no arguments` } : { name };
    default:
      return { name: 'invalid', reason: name ? `unknown command \`${name.slice(0, 40)}\`` : 'no command given' };
  }
}

export const BOT_HELP = [
  '`loadweaver plan [project|path]` re-plans this pull request (optionally only one project or path)',
  '`loadweaver apply [--confirm]` applies the plan (the pull request must be mergeable and approved per the project rules)',
  '`loadweaver approve` approves the plan (operators / admins of the touched projects)',
  '`loadweaver unlock` releases the locks of this pull request and discards its plan',
  '`loadweaver drift` shows the current drift of the scope',
].join('\n- ');

// ---------------------------------------------------------------------------------------------------------------
// Webhook payloads (3.30)
// ---------------------------------------------------------------------------------------------------------------

export type BotEvent =
  | {
      kind: 'pull-request';
      action: 'opened' | 'updated' | 'closed' | 'merged' | 'other';
      number: number;
      headSha: string | null;
      headRef: string | null;
      baseRef: string | null;
      title: string;
      url: string | null;
      author: string | null;
      /** From another repository (fork): planned only on `loadweaver plan` by a linked account (3.30). */
      fork: boolean;
    }
  | {
      kind: 'comment';
      number: number;
      commentId: string;
      /**
       * Body, author and bot flag as the payload claims them: only used to decide whether to look at the comment;
       * the bot acts on the comment as the provider API returns it (3.30).
       */
      body: string;
      userId: string;
      login: string;
      isBot: boolean;
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider webhook JSON
type Json = any;

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
}

/**
 * The pull request comes from a fork: head and base repository differ, or the head repository is unknown while the
 * base is known (GitHub reports a deleted fork as `head.repo: null`).
 */
export function isFork(head: unknown, base: unknown): boolean {
  if (base === undefined || base === null) return head !== undefined && head !== null;

  return head === undefined || head === null || String(head) !== String(base);
}

/**
 * Pull request and comment events of GitHub (`pull_request`, `issue_comment` on pull requests) and GitLab (`Merge
 * Request Hook`, `Note Hook` on merge requests). Everything else is null (pushes are the sync's).
 */
export function parseBotEvent(provider: 'github' | 'gitlab', event: string, payload: Json): BotEvent | null {
  if (!payload || typeof payload !== 'object') return null;

  const e = event.toLowerCase();

  if (provider === 'github') {
    if (e === 'pull_request' && payload.pull_request) {
      const pr = payload.pull_request;
      const action: string = payload.action;
      const mapped =
        action === 'opened' || action === 'reopened' || action === 'ready_for_review'
          ? 'opened'
          : action === 'synchronize'
            ? 'updated'
            : action === 'closed'
              ? pr.merged
                ? 'merged'
                : 'closed'
              : 'other';

      return {
        kind: 'pull-request',
        action: mapped,
        number: Number(pr.number),
        headSha: str(pr.head?.sha),
        headRef: str(pr.head?.ref),
        baseRef: str(pr.base?.ref),
        title: String(pr.title ?? '').slice(0, 300),
        url: str(pr.html_url),
        author: str(pr.user?.login),
        fork: isFork(pr.head?.repo?.full_name, pr.base?.repo?.full_name),
      };
    }

    if (e === 'issue_comment' && payload.action === 'created' && payload.issue?.pull_request && payload.comment) {
      return {
        kind: 'comment',
        number: Number(payload.issue.number),
        commentId: String(payload.comment.id),
        body: String(payload.comment.body ?? ''),
        userId: String(payload.comment.user?.id ?? ''),
        login: String(payload.comment.user?.login ?? ''),
        isBot: payload.comment.user?.type === 'Bot',
      };
    }

    return null;
  }

  if (e === 'merge request hook' && payload.object_attributes) {
    const mr = payload.object_attributes;
    const action: string = mr.action;
    // `update` without new commits (title, labels, ...) doesn't need a new plan.
    const mapped =
      action === 'open' || action === 'reopen'
        ? 'opened'
        : action === 'update'
          ? mr.oldrev
            ? 'updated'
            : 'other'
          : action === 'close'
            ? 'closed'
            : action === 'merge'
              ? 'merged'
              : 'other';

    return {
      kind: 'pull-request',
      action: mapped,
      number: Number(mr.iid),
      headSha: str(mr.last_commit?.id),
      headRef: str(mr.source_branch),
      baseRef: str(mr.target_branch),
      title: String(mr.title ?? '').slice(0, 300),
      url: str(mr.url),
      author: str(payload.user?.username),
      fork: isFork(mr.source_project_id, mr.target_project_id),
    };
  }

  if (
    e === 'note hook' &&
    payload.object_attributes?.noteable_type === 'MergeRequest' &&
    payload.merge_request &&
    !payload.object_attributes.system
  ) {
    return {
      kind: 'comment',
      number: Number(payload.merge_request.iid),
      commentId: String(payload.object_attributes.id),
      body: String(payload.object_attributes.note ?? ''),
      userId: String(payload.user?.id ?? ''),
      login: String(payload.user?.username ?? ''),
      isBot: payload.user?.bot === true,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Mergeability (3.30): checks other than Loadweaver's own status green, no conflicts, not a draft
// ---------------------------------------------------------------------------------------------------------------

/**
 * GitHub: the pull request, the commit's combined statuses and check runs, and the review decision (required reviews
 * of branch protection / code owners, like GitLab's `not_approved`): `REVIEW_REQUIRED` and `CHANGES_REQUESTED`
 * block, `unknown` (GitHub didn't answer) blocks until it does.
 */
export function githubMergeability(
  pr: Json,
  statuses: readonly { context: string; state: string }[],
  checkRuns: readonly { name: string; status: string; conclusion: string | null }[],
  ownContext: string,
  reviewDecision: string | null = null,
): Mergeability {
  const reasons: string[] = [];
  let pending = false;

  if (reviewDecision === 'REVIEW_REQUIRED') reasons.push('it needs the reviews GitHub requires');
  else if (reviewDecision === 'CHANGES_REQUESTED') reasons.push('a reviewer requested changes');
  else if (reviewDecision === 'unknown') {
    pending = true;
    reasons.push('GitHub did not report the review decision; try again in a moment');
  }

  if (pr.state !== 'open' || pr.merged) reasons.push('the pull request is not open');

  if (pr.draft) reasons.push('the pull request is a draft');

  if (pr.mergeable === false || pr.mergeable_state === 'dirty') reasons.push('it has merge conflicts');
  else if (pr.mergeable === null || pr.mergeable === undefined || pr.mergeable_state === 'unknown') {
    pending = true;
    reasons.push('GitHub is still checking whether it can be merged; try again in a moment');
  }

  if (pr.mergeable_state === 'behind') reasons.push('the branch is behind the base branch; update it first');

  for (const s of statuses.filter((x) => x.context !== ownContext)) {
    if (s.state === 'pending') {
      pending = true;
      reasons.push(`check \`${s.context}\` is still running`);
    } else if (s.state !== 'success') reasons.push(`check \`${s.context}\` is ${s.state}`);
  }

  for (const run of checkRuns.filter((x) => x.name !== ownContext)) {
    if (run.status !== 'completed') {
      pending = true;
      reasons.push(`check \`${run.name}\` is still running`);
    } else if (!['success', 'neutral', 'skipped'].includes(run.conclusion ?? '')) {
      reasons.push(`check \`${run.name}\` is ${run.conclusion ?? 'unknown'}`);
    }
  }

  return { mergeable: reasons.length === 0, pending: pending && reasons.length > 0, reasons };
}

const GITLAB_BLOCKERS: Record<string, string> = {
  conflict: 'it has merge conflicts',
  draft_status: 'the merge request is a draft',
  discussions_not_resolved: 'open discussions must be resolved first',
  not_approved: 'it needs the approvals GitLab requires',
  requested_changes: 'a reviewer requested changes',
  need_rebase: 'the branch must be rebased first',
  blocked_status: 'it is blocked by another merge request',
  not_open: 'the merge request is not open',
  jira_association_missing: 'a Jira issue must be referenced',
  merge_request_blocked: 'it is blocked by another merge request',
  security_policy_violations: 'security policies are violated',
  locked_paths: 'it changes locked paths',
  locked_lfs_files: 'it changes locked LFS files',
  title_regex: 'the title does not match the required pattern',
  commits_status: 'the source branch is missing or out of date',
  broken_status: 'the source branch cannot be merged',
};

/** GitLab: the merge request and the commit's statuses (pipeline jobs and external statuses). */
export function gitlabMergeability(
  mr: Json,
  statuses: readonly { id?: number; name: string; status: string; allow_failure?: boolean }[],
  ownContext: string,
): Mergeability {
  const reasons: string[] = [];
  let pending = false;

  if (mr.state !== 'opened') reasons.push('the merge request is not open');

  if (mr.draft || mr.work_in_progress) reasons.push('the merge request is a draft');

  const detailed: string | undefined = mr.detailed_merge_status;

  // CI states are checked below without Loadweaver's own status (which is pending until the apply).
  if (detailed && !['mergeable', 'ci_must_pass', 'ci_still_running'].includes(detailed)) {
    if (['checking', 'unchecked', 'preparing', 'approvals_syncing'].includes(detailed)) {
      pending = true;
      reasons.push('GitLab is still checking whether it can be merged; try again in a moment');
    } else if (!(detailed === 'draft_status' && reasons.includes('the merge request is a draft')))
      reasons.push(GITLAB_BLOCKERS[detailed] ?? `GitLab reports \`${String(detailed).slice(0, 40)}\``);
  } else if (!detailed) {
    if (mr.merge_status === 'cannot_be_merged' || mr.has_conflicts) reasons.push('it has merge conflicts');
    else if (mr.merge_status !== 'can_be_merged') {
      pending = true;
      reasons.push('GitLab is still checking whether it can be merged; try again in a moment');
    }
  }

  // The newest status per name counts.
  const latest = new Map<string, { status: string; allow_failure?: boolean }>();

  for (const s of [...statuses].sort((a, b) => (b.id ?? 0) - (a.id ?? 0)))
    if (!latest.has(s.name)) latest.set(s.name, s);

  for (const [name, s] of latest) {
    if (name === ownContext) continue;

    if (['pending', 'running', 'created', 'waiting_for_resource', 'preparing', 'scheduled'].includes(s.status)) {
      pending = true;
      reasons.push(`check \`${name}\` is still running`);
    } else if (['failed', 'canceled'].includes(s.status) && !s.allow_failure) {
      reasons.push(`check \`${name}\` is ${s.status}`);
    }
  }

  return { mergeable: reasons.length === 0, pending: pending && reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------------------------------------------
// OAuth state (account linking): HMAC-signed, expiring, single use (the nonce is stored and deleted on use)
// ---------------------------------------------------------------------------------------------------------------

/** States are valid this long (at most 10 minutes). */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

export interface OAuthState {
  userId: string;
  provider: GitAccountProvider;
  nonce: string;
  /** Expiry, epoch milliseconds. */
  expiresAt: number;
}

function stateKey(encryptionKey: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(encryptionKey, 'utf8'), Buffer.alloc(0), 'loadweaver/git-oauth-state', 32),
  );
}

export function newOAuthNonce(): string {
  return randomBytes(24).toString('base64url');
}

/** `<payload>.<signature>` (both base64url); the key is derived from `ENCRYPTION_KEY`. */
export function signOAuthState(encryptionKey: string, state: OAuthState): string {
  const payload = Buffer.from(
    JSON.stringify({ u: state.userId, p: state.provider, n: state.nonce, e: state.expiresAt }),
    'utf8',
  ).toString('base64url');
  const signature = createHmac('sha256', stateKey(encryptionKey)).update(payload).digest('base64url');

  return `${payload}.${signature}`;
}

/** The state if the signature is right (constant time) and it hasn't expired; null otherwise. */
export function verifyOAuthState(encryptionKey: string, token: string, now = Date.now()): OAuthState | null {
  if (typeof token !== 'string' || token.length > 1024) return null;

  const [payload, signature, ...rest] = token.split('.');

  if (!payload || !signature || rest.length > 0) return null;

  const expected = createHmac('sha256', stateKey(encryptionKey)).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');

  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      u?: unknown;
      p?: unknown;
      n?: unknown;
      e?: unknown;
    };

    if (
      typeof parsed.u !== 'string' ||
      (parsed.p !== 'github' && parsed.p !== 'gitlab') ||
      typeof parsed.n !== 'string' ||
      typeof parsed.e !== 'number' ||
      parsed.e < now ||
      parsed.e > now + OAUTH_STATE_TTL_MS + 60_000
    )
      return null;

    return { userId: parsed.u, provider: parsed.p, nonce: parsed.n, expiresAt: parsed.e };
  } catch {
    return null;
  }
}
