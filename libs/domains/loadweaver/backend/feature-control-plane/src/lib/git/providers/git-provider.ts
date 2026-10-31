import { request } from 'node:https';

import type { GitProviderKind } from '../../entities/git.entity';
import type { CommitStatusState } from '../git-sync.utils';

/** What a provider call needs: API base, repository (`owner/repo`, `group/sub/project`), token, private CA. */
export interface GitProviderContext {
  apiBase: string;
  repo: string;
  token: string | null;
  caCertificate?: string | null;
  timeoutMs?: number;
}

export interface CommitStatusInput {
  sha: string;
  state: CommitStatusState;
  description: string;
  /** `loadweaver/plan`. */
  context: string;
  targetUrl?: string;
}

export interface PullRequestInput {
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface PullRequestRef {
  number: number;
  url: string;
}

/**
 * A Git hosting provider's API (3.29). The plan bot (3.30) extends this with comments, reviews and merges; plain Git
 * has no API (every call is a no-op).
 */
export interface GitProviderAdapter {
  readonly kind: GitProviderKind;
  /** Whether the provider has an API (statuses, pull requests). */
  readonly hasApi: boolean;
  setCommitStatus(ctx: GitProviderContext, input: CommitStatusInput): Promise<void>;
  /** Opens a pull / merge request (or returns the open one for the same branch); null without an API. */
  createPullRequest(ctx: GitProviderContext, input: PullRequestInput): Promise<PullRequestRef | null>;
  getDefaultBranch(ctx: GitProviderContext): Promise<string | null>;
}

/** A pull / merge request as the plan bot sees it (3.30). */
export interface PullRequestInfo {
  number: number;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  title: string;
  url: string;
  /** Provider login of the author. */
  author: string | null;
  /** Provider user id of the author (from the API, not a webhook payload). */
  authorId: string | null;
  headSha: string;
  headRef: string;
  baseRef: string;
  /** From another repository (fork). */
  fork: boolean;
}

/** Whether a pull request may be applied / merged now: other checks green, no conflicts, not a draft. */
export interface Mergeability {
  mergeable: boolean;
  /** Not decided yet (provider still computing, checks running): try again. */
  pending: boolean;
  reasons: string[];
}

/** An approving review / approval by a provider account. */
export interface ReviewApproval {
  userId: string;
  login: string;
}

/** Approvals of the current head, and why others were ignored (shown to the commenter). */
export interface ReviewApprovals {
  approvals: ReviewApproval[];
  ignored: string | null;
}

/** A pull request comment as the provider API returns it (the webhook payload is never trusted for this). */
export interface BotComment {
  id: string;
  body: string;
  userId: string;
  login: string;
  isBot: boolean;
  createdAt: Date;
}

export type BotReaction = 'eyes' | '+1' | '-1' | 'rocket' | 'confused';

/**
 * What the plan bot (3.30) needs from GitHub / GitLab: pull request heads, one sticky comment, replies and reactions,
 * mergeability (checks other than Loadweaver's own status), approvals, and the merge after an apply.
 */
export interface GitBotProvider {
  /** The ref that holds a pull request's head in the base repository (also for forks). */
  pullRequestRef(number: number): string;
  getPullRequest(ctx: GitProviderContext, number: number): Promise<PullRequestInfo>;
  createComment(ctx: GitProviderContext, number: number, body: string): Promise<string>;
  /** False when the comment is gone (deleted by someone): the caller creates a new one. */
  updateComment(ctx: GitProviderContext, number: number, id: string, body: string): Promise<boolean>;
  /** The newest comment containing `marker` (sticky comment recovery). */
  findComment(ctx: GitProviderContext, number: number, marker: string): Promise<string | null>;
  /** A comment of this pull request by id (author, body, time from the API); null if it doesn't exist there. */
  getComment(ctx: GitProviderContext, number: number, commentId: string): Promise<BotComment | null>;
  react(ctx: GitProviderContext, number: number, commentId: string, reaction: BotReaction): Promise<void>;
  /** Other checks green, no conflicts, not a draft, the reviews / approvals the provider requires. */
  mergeability(ctx: GitProviderContext, pr: PullRequestInfo, ownContext: string): Promise<Mergeability>;
  /**
   * Approvals of the current head: GitHub reviews on the head commit; GitLab approvals only if the project resets them
   * on push or they were given after the head was pushed.
   */
  approvals(ctx: GitProviderContext, pr: PullRequestInfo): Promise<ReviewApprovals>;
  /** Merges exactly `sha` (the applied commit): the provider refuses if the head moved meanwhile. */
  merge(ctx: GitProviderContext, number: number, sha: string, title: string): Promise<void>;
}

export class GitProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitProviderError';
  }
}

export interface JsonResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider JSON bodies
  json: any;
}

const MAX_RESPONSE_BYTES = 1024 * 1024;

/** One HTTPS JSON request (no redirects, bounded body, optional private CA); the token never ends up in errors. */
export async function providerRequest(
  ctx: Pick<GitProviderContext, 'caCertificate' | 'timeoutMs'>,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<JsonResponse> {
  const target = new URL(url);

  if (target.protocol !== 'https:') throw new GitProviderError(0, 'provider API calls need https');

  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');

  return await new Promise<JsonResponse>((resolve, reject) => {
    const req = request(
      target,
      {
        method,
        headers: {
          accept: 'application/json',
          'user-agent': 'loadweaver-control-plane',
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
          ...headers,
        },
        ...(ctx.caCertificate ? { ca: ctx.caCertificate } : {}),
        timeout: ctx.timeoutMs ?? 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;

        res.on('data', (chunk: Buffer) => {
          size += chunk.length;

          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new GitProviderError(0, 'provider response too large'));

            return;
          }

          chunks.push(chunk);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;

          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }

          resolve({ status: res.statusCode ?? 0, json });
        });
        res.on('error', reject);
      },
    );

    req.on('timeout', () => req.destroy(new GitProviderError(0, `${method} ${target.host} timed out`)));
    req.on('error', (error) =>
      reject(error instanceof GitProviderError ? error : new GitProviderError(0, `${target.host}: ${error.message}`)),
    );
    req.end(payload);
  });
}

/** A short reason from a provider error body (`message` / `error`), never echoing headers. */
export function providerFailure(what: string, res: JsonResponse): GitProviderError {
  const detail =
    res.json && typeof res.json === 'object'
      ? String(res.json.message ?? res.json.error ?? res.json.error_description ?? '').slice(0, 200)
      : '';

  return new GitProviderError(res.status, `${what}: HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
}

/** Plain Git over SSH / HTTPS: no API; statuses and pull requests don't exist (the branch is pushed instead). */
export class PlainGitProvider implements GitProviderAdapter {
  readonly kind = 'git' as const;
  readonly hasApi = false;

  async setCommitStatus(): Promise<void> {
    return;
  }

  async createPullRequest(): Promise<PullRequestRef | null> {
    return null;
  }

  async getDefaultBranch(): Promise<string | null> {
    return null;
  }
}
