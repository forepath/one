/**
 * GitOps (3.29 / 3.30): `/git/connections*` (per scope repository, branch, path and mode), the commits Loadweaver
 * synced or wrote, the cluster's SOPS age recipient and the Git accounts linked to the signed-in user.
 */

export const GIT_PROVIDERS = ['github', 'gitlab', 'gitea', 'git'] as const;
/** `git`: plain Git (no commit statuses, no pull requests). */
export type GitProviderKind = (typeof GIT_PROVIDERS)[number];

export const GIT_MODES = ['authoritative', 'bidirectional'] as const;
/** Authoritative: UI / API edits become pull requests. Bidirectional: they apply and are committed back. */
export type GitMode = (typeof GIT_MODES)[number];

/** `push`: a synced branch head; `commit-back`, `export`: written by Loadweaver; `plan-branch`: a PR branch. */
export type GitCommitKind = 'push' | 'commit-back' | 'export' | 'plan-branch';

/** Where a commit stands; the commit status (`loadweaver/plan`) follows it. */
export type GitCommitState =
  | 'pending'
  | 'approved'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'discarded'
  | 'rejected'
  | 'no-changes'
  | 'synced';

/** `GitConnectionDto`: one scope's repository. */
export interface GitConnection {
  id: string;
  /** null = the cluster scope. */
  project: string | null;
  provider: GitProviderKind;
  repoUrl: string;
  branch: string;
  /** Directory inside the repository ('' = root). */
  path: string;
  mode: GitMode;
  /** `secret://project/name`. */
  credentials: string | null;
  apiUrl: string | null;
  caCertificate: string | null;
  /** null = webhooks only. */
  pollIntervalSeconds: number | null;
  webhook: boolean;
  /** Where the provider sends webhooks (`/api/git/webhooks/<id>`). */
  webhookPath: string;
  approvalByMergeReview: boolean;
  membershipsFromGit: boolean;
  autoMerge: boolean;
  sops: boolean;
  /**
   * GitHub: the connection uses the cluster's GitHub App (`Cluster.spec.git.github`) when it has no own token. Only
   * cluster admins enable it; a change of repository, API URL or provider by anyone else turns it off.
   */
  githubApp: boolean;
  /** How often the webhook secret was rotated (0: the original secret). */
  webhookGeneration: number;
  /** Pinned SSH host key(s), known_hosts lines. */
  hostKey: string | null;
  lastSyncedCommit: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `POST /git/connections` answers the webhook secret once. */
export interface CreatedGitConnection extends GitConnection {
  webhookSecret: string;
}

/** Settings shared by create and update. */
export interface GitConnectionSettings {
  path?: string;
  credentials?: string | null;
  apiUrl?: string | null;
  caCertificate?: string | null;
  /** 10 to 86,400 seconds; null = webhooks only. */
  pollIntervalSeconds?: number | null;
  webhook?: boolean;
  approvalByMergeReview?: boolean;
  membershipsFromGit?: boolean;
  autoMerge?: boolean;
  sops?: boolean;
  /** GitHub only; only cluster admins may enable it. */
  githubApp?: boolean;
}

/** `POST /git/connections`. No `project`: the cluster scope. */
export interface CreateGitConnectionRequest extends GitConnectionSettings {
  project?: string;
  provider: GitProviderKind;
  repoUrl: string;
  branch: string;
  mode: GitMode;
}

/** `PATCH /git/connections/{id}`. */
export interface UpdateGitConnectionRequest extends GitConnectionSettings {
  provider?: GitProviderKind;
  repoUrl?: string;
  branch?: string;
  mode?: GitMode;
}

/** `GET /git/connections/{id}/commits`: synced and written commits, newest first. */
export interface GitCommit {
  id: string;
  sha: string;
  ref: string;
  kind: GitCommitKind;
  planId: string | null;
  author: string | null;
  message: string | null;
  state: GitCommitState;
  /** The state last reported as commit status. */
  reportedState: GitCommitState | null;
  /** Why a push was rejected or couldn't be planned (file, line and rule; never a secret value). */
  reason: string | null;
  prUrl: string | null;
  prNumber: number | null;
  createdAt: string;
}

/** `POST /git/connections/{id}/test`. */
export interface GitTestResult {
  ok: boolean;
  head: string | null;
  defaultBranch?: string | null;
  hostKey: string | null;
  error?: string;
}

/** `POST /git/connections/{id}/sync`: what the branch head became. */
export interface GitSyncResult {
  commit: string | null;
  state: GitCommitState | 'unchanged' | 'error';
  planId: string | null;
  reason: string | null;
}

/** `POST /git/connections/{id}/export`. */
export interface GitExportResult {
  commit: string | null;
  resources: number;
  changed: boolean;
  /** Resources from SOPS-encrypted files: never exported (they would be written in clear). */
  skipped?: string[];
}

/** `POST /git/connections/{id}/webhook-secret/rotate` (audited): the new secret, shown once; the old one stops working. */
export interface RotatedGitWebhookSecret {
  webhookSecret: string;
  webhookGeneration: number;
}

/** The actions on a connection that answer something the console shows. */
export type GitConnectionActionKind = 'test' | 'sync' | 'export' | 'reset-host-key';

/** What the last action on a connection answered. */
export type GitConnectionActionResult =
  | { action: 'test'; result: GitTestResult }
  | { action: 'sync'; result: GitSyncResult }
  | { action: 'export'; result: GitExportResult }
  | { action: 'reset-host-key'; result: GitConnection };

/** "Default branch ahead of cluster" (`GET /drift` → `gitAhead`): the branch head's plan isn't applied. */
export interface GitAheadEntry {
  connection: string;
  /** `cluster` or the project. */
  scope: string;
  commit: string;
  planId: string | null;
  state: GitCommitState;
  reason: string | null;
  since: string;
}

/**
 * `GET /git/sops/recipient`: the cluster's public age recipient (created on first need). 404: SOPS isn't available on
 * this cluster; 409: the identity can't be read (e.g. the master key is missing).
 */
export interface GitSopsRecipient {
  recipient: string | null;
  createdAt?: string;
}

export const GIT_ACCOUNT_PROVIDERS = ['github', 'gitlab'] as const;
export type GitAccountProvider = (typeof GIT_ACCOUNT_PROVIDERS)[number];

/** `GET /git/accounts`: a Git account linked to the signed-in user (only the provider's user id and login). */
export interface GitAccount {
  id: string;
  provider: GitAccountProvider;
  providerUserId: string;
  login: string;
  createdAt: string;
}

/** `POST /git/accounts/{provider}/authorize`: where the browser goes (signed single-use state, valid 10 minutes). */
export interface GitAccountAuthorization {
  url: string;
  expiresAt?: string;
}

/**
 * `GET /git/accounts/pending/{nonce}`: an account the OAuth callback found, waiting for the same user to confirm the
 * link (404: unknown, expired or another user's).
 */
export interface GitAccountPendingLink {
  provider: GitAccountProvider;
  login: string;
  providerUserId: string;
  expiresAt: string;
}

/**
 * Why the OAuth callback didn't link; the control plane redirects to `/settings/git-accounts?error=<code>` (a fixed
 * code, never provider text) or `?confirm=<nonce>` (the link waits for the user's confirmation; older control planes:
 * `?linked=<provider>`).
 */
export type GitLinkError = 'invalid-state' | 'denied' | 'not-configured' | 'exchange-failed' | 'already-linked';
