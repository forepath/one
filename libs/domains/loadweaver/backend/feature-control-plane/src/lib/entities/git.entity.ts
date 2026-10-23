import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const GIT_PROVIDERS = ['github', 'gitlab', 'gitea', 'git'] as const;
export type GitProviderKind = (typeof GIT_PROVIDERS)[number];

export const GIT_MODES = ['authoritative', 'bidirectional'] as const;
/** Authoritative: UI / API edits become pull requests. Bidirectional: they apply and are committed back (3.29). */
export type GitMode = (typeof GIT_MODES)[number];

/**
 * A scope's repository (3.29): the cluster scope (`project` null) or one project, managed directly (never by plans).
 * Credentials are a `secret://` reference resolved only for the Git / provider call; the webhook secret is derived
 * (HKDF from `ENCRYPTION_KEY` + id + a rotatable salt), so nothing secret is stored here.
 */
@Entity('lw_git_connections')
export class GitConnectionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** null = the cluster scope. */
  @Column({ type: 'varchar', length: 63, name: 'project', nullable: true })
  project!: string | null;

  /** '' for the cluster scope; one connection per scope. */
  @Index('UQ_lw_git_connections_scope', { unique: true })
  @Column({ type: 'varchar', length: 63, name: 'scope_key' })
  scopeKey!: string;

  @Column({ type: 'varchar', length: 16, name: 'provider' })
  provider!: GitProviderKind;

  @Column({ type: 'text', name: 'repo_url' })
  repoUrl!: string;

  @Column({ type: 'varchar', length: 255, name: 'branch' })
  branch!: string;

  /** Directory inside the repository ('' = root). */
  @Column({ type: 'varchar', length: 512, name: 'path', default: '' })
  path!: string;

  @Column({ type: 'varchar', length: 16, name: 'mode' })
  mode!: GitMode;

  /** `secret://` reference: a token, an SSH private key, or JSON `{ token, username, sshPrivateKey }`. */
  @Column({ type: 'varchar', length: 300, name: 'credentials', nullable: true })
  credentials!: string | null;

  /** Provider API base URL (self-hosted GitLab / Gitea / GitHub Enterprise); derived from the repo URL if empty. */
  @Column({ type: 'text', name: 'api_url', nullable: true })
  apiUrl!: string | null;

  /** PEM CA certificate(s) for providers behind a private CA (Git over HTTPS and the provider API). */
  @Column({ type: 'text', name: 'ca_certificate', nullable: true })
  caCertificate!: string | null;

  /** Polling interval; null = webhooks only. */
  @Column({ type: 'integer', name: 'poll_interval_seconds', nullable: true })
  pollIntervalSeconds!: number | null;

  @Column({ type: 'boolean', name: 'webhook', default: true })
  webhook!: boolean;

  /** A merge review counts as the approval (used by the plan bot, 3.30). */
  @Column({ type: 'boolean', name: 'approval_by_merge_review', default: false })
  approvalByMergeReview!: boolean;

  /** `access.yaml` in the path is imported on sync; direct changes are committed back. */
  @Column({ type: 'boolean', name: 'memberships_from_git', default: false })
  membershipsFromGit!: boolean;

  /** Merge the PR after a successful bot apply (3.30). */
  @Column({ type: 'boolean', name: 'auto_merge', default: true })
  autoMerge!: boolean;

  /**
   * GitHub: without own credentials, use the cluster's GitHub App installation token (3.30). Only cluster admins may
   * turn it on (the app may be installed on repositories of other teams); changing the repository turns it off.
   */
  @Column({ type: 'boolean', name: 'github_app', default: false })
  githubApp!: boolean;

  /** SOPS-encrypted files are decrypted with the cluster's age identity. */
  @Column({ type: 'boolean', name: 'sops', default: false })
  sops!: boolean;

  /**
   * Random salt of the webhook secret (HKDF info), replaced on rotation so a leaked secret can be revoked without
   * recreating the connection; null = the original derivation of connections created before rotation existed.
   */
  @Column({ type: 'varchar', length: 64, name: 'webhook_salt', nullable: true })
  webhookSalt!: string | null;

  /** How often the webhook secret was rotated (0 = the original secret). */
  @Column({ type: 'integer', name: 'webhook_generation', default: 0 })
  webhookGeneration!: number;

  /**
   * Who pushed the newest default-branch head (webhook `sender` / `user_id` mapped to linked Loadweaver users): hints
   * that only exclude those users from approving that commit's plan, never grant anything.
   */
  @Column({ type: 'jsonb', name: 'push_authors', nullable: true })
  pushAuthors!: { sha: string | null; users: string[] } | null;

  /** Pinned SSH host key(s) as known_hosts lines (trust on first use). */
  @Column({ type: 'text', name: 'host_key', nullable: true })
  hostKey!: string | null;

  /** Head commit of the branch the last sync handled. */
  @Column({ type: 'varchar', length: 64, name: 'last_synced_commit', nullable: true })
  lastSyncedCommit!: string | null;

  @Column({ type: 'timestamptz', name: 'last_sync_at', nullable: true })
  lastSyncAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_poll_at', nullable: true })
  lastPollAt!: Date | null;

  /** A webhook (or the sync action) asked for a sync; the loop picks it up. */
  @Column({ type: 'boolean', name: 'sync_requested', default: false })
  syncRequested!: boolean;

  /** Last transport / provider error (scrubbed), shown on the connection and in the inbox. */
  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * `push`: a synced branch head; `commit-back`, `export`: written by Loadweaver; `plan-branch`: a PR branch;
 * `pull-request`: a pull / merge request head planned by the plan bot (3.30).
 */
export type GitCommitKind = 'push' | 'commit-back' | 'export' | 'plan-branch' | 'pull-request';

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

/** A commit Loadweaver handled or wrote, with the plan it created and the status reported for it. */
@Entity('lw_git_commits')
@Index('IDX_lw_git_commits_connection', ['connectionId', 'createdAt'])
export class GitCommitEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 64, name: 'sha' })
  sha!: string;

  @Column({ type: 'varchar', length: 255, name: 'ref' })
  ref!: string;

  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: GitCommitKind;

  @Index('IDX_lw_git_commits_plan')
  @Column({ type: 'uuid', name: 'plan_id', nullable: true })
  planId!: string | null;

  /** Commit author (`Name <email>`) or the Loadweaver user who caused the commit. */
  @Column({ type: 'varchar', length: 255, name: 'author', nullable: true })
  author!: string | null;

  @Column({ type: 'varchar', length: 200, name: 'message', nullable: true })
  message!: string | null;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: GitCommitState;

  /** The state last reported as commit status; differs from `state` until reported. */
  @Column({ type: 'varchar', length: 16, name: 'reported_state', nullable: true })
  reportedState!: GitCommitState | null;

  /** Why a push was rejected or couldn't be planned (file, line and rule; never a secret value). */
  @Column({ type: 'text', name: 'reason', nullable: true })
  reason!: string | null;

  /** Per resource (`Kind/project/name`): the file it was read from (for write-back after the apply). */
  @Column({ type: 'jsonb', name: 'paths', default: () => "'{}'" })
  paths!: Record<string, string>;

  /** Resources (`Kind/project/name`) read from SOPS-encrypted files: never written back or exported in clear. */
  @Column({ type: 'jsonb', name: 'sops_keys', default: () => "'[]'" })
  sopsKeys!: string[];

  @Column({ type: 'text', name: 'pr_url', nullable: true })
  prUrl!: string | null;

  @Column({ type: 'integer', name: 'pr_number', nullable: true })
  prNumber!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * Per connection and resource: where it lives in the repo and the generation that matched Git at the last sync
 * or write. A resource whose generation moved since is changed outside Git (a `git-conflict` in the next plan).
 */
@Entity('lw_git_resource_state')
export class GitResourceStateEntity {
  @PrimaryColumn({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @PrimaryColumn({ type: 'varchar', length: 64, name: 'kind' })
  kind!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'project_key' })
  projectKey!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 1024, name: 'path' })
  path!: string;

  @Column({ type: 'integer', name: 'generation' })
  generation!: number;

  @Column({ type: 'varchar', length: 64, name: 'commit' })
  commit!: string;

  /** Read from a SOPS-encrypted file: Loadweaver never writes it back or exports it in clear. */
  @Column({ type: 'boolean', name: 'sops', default: false })
  sops!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const GIT_ACCOUNT_PROVIDERS = ['github', 'gitlab'] as const;
export type GitAccountProvider = (typeof GIT_ACCOUNT_PROVIDERS)[number];

/**
 * A Git account linked to a Loadweaver user (3.30): only the provider's user id and login are stored; the OAuth
 * token used to read them is discarded. Bot commands of that account act with the user's roles.
 */
@Entity('lw_git_accounts')
@Index('UQ_lw_git_accounts_provider_user', ['provider', 'providerUserId'], { unique: true })
@Index('UQ_lw_git_accounts_user_provider', ['userId', 'provider'], { unique: true })
export class GitAccountEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 255, name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 16, name: 'provider' })
  provider!: GitAccountProvider;

  /** The provider's numeric user id (stable across renames). */
  @Column({ type: 'varchar', length: 64, name: 'provider_user_id' })
  providerUserId!: string;

  @Column({ type: 'varchar', length: 255, name: 'login' })
  login!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** A pending OAuth link (single use, expires after 10 minutes): the nonce of the signed state. */
@Entity('lw_git_oauth_states')
export class GitOAuthStateEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'nonce' })
  nonce!: string;

  @Column({ type: 'varchar', length: 255, name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 16, name: 'provider' })
  provider!: GitAccountProvider;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;
}

/**
 * An OAuth link waiting for the user's confirmation in the console (10 minutes): the callback only records which
 * provider account came back; the signed-in user who started the flow confirms it (`POST /git/accounts/confirm`).
 */
@Entity('lw_git_pending_links')
export class GitPendingLinkEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'nonce' })
  nonce!: string;

  @Column({ type: 'varchar', length: 255, name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 16, name: 'provider' })
  provider!: GitAccountProvider;

  @Column({ type: 'varchar', length: 64, name: 'provider_user_id' })
  providerUserId!: string;

  @Column({ type: 'varchar', length: 255, name: 'login' })
  login!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;
}

/** Webhook deliveries and bot comments already handled (replay protection, kept 7 days). */
@Entity('lw_git_webhook_deliveries')
@Index('IDX_lw_git_webhook_deliveries_created', ['createdAt'])
export class GitWebhookDeliveryEntity {
  @PrimaryColumn({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  /** `delivery:<provider delivery id>` or `comment:<comment / note id>`. */
  @PrimaryColumn({ type: 'varchar', length: 160, name: 'key' })
  key!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Leases serializing Git work per connection (and the sync loop) across replicas without holding a database
 * connection during clones / pushes: taken with one statement, renewed while the work runs, released afterwards.
 */
@Entity('lw_git_locks')
export class GitLockEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'key' })
  key!: string;

  @Column({ type: 'varchar', length: 64, name: 'owner' })
  owner!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;
}

export type GitPullRequestState = 'open' | 'closed' | 'merged';

/**
 * A pull / merge request the plan bot follows (3.30): its head, the current plan (whose locks it holds), the sticky
 * comment, and the apply it triggered. The plan's resource locks live in `lw_resource_locks` like apply locks.
 */
@Entity('lw_git_pull_requests')
@Index('UQ_lw_git_pull_requests_number', ['connectionId', 'number'], { unique: true })
export class GitPullRequestEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @Column({ type: 'integer', name: 'number' })
  number!: number;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: GitPullRequestState;

  @Column({ type: 'varchar', length: 300, name: 'title', default: '' })
  title!: string;

  @Column({ type: 'text', name: 'url', nullable: true })
  url!: string | null;

  /** Provider login of the author. */
  @Column({ type: 'varchar', length: 255, name: 'author', nullable: true })
  author!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'head_ref', default: '' })
  headRef!: string;

  @Column({ type: 'varchar', length: 64, name: 'head_sha', default: '' })
  headSha!: string;

  @Column({ type: 'uuid', name: 'plan_id', nullable: true })
  planId!: string | null;

  /** The sticky comment (GitHub comment id / GitLab note id). */
  @Column({ type: 'varchar', length: 64, name: 'comment_id', nullable: true })
  commentId!: string | null;

  /** The plan `loadweaver apply` started; its result is posted once (`resultPosted`). */
  @Column({ type: 'uuid', name: 'apply_plan_id', nullable: true })
  applyPlanId!: string | null;

  @Column({ type: 'boolean', name: 'result_posted', default: true })
  resultPosted!: boolean;

  /** Who applied (Loadweaver user) and how the PR is merged afterwards. */
  @Column({ type: 'varchar', length: 255, name: 'applied_by', nullable: true })
  appliedBy!: string | null;

  /** Last bot error on this PR (scrubbed), shown in the comment. */
  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * The cluster's age identity for SOPS (3.29): the public recipient, and the identity envelope-encrypted with the
 * master key (re-wrapped with every master key change, like secrets).
 */
@Entity('lw_git_sops_keys')
export class GitSopsKeyEntity {
  /** `cluster`: one identity per cluster. */
  @PrimaryColumn({ type: 'varchar', length: 16, name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 128, name: 'recipient' })
  recipient!: string;

  @Column({ type: 'varchar', length: 16, name: 'key_id' })
  keyId!: string;

  @Column({ type: 'bytea', name: 'wrapped_key' })
  wrappedKey!: Buffer;

  @Column({ type: 'bytea', name: 'ciphertext' })
  ciphertext!: Buffer;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
