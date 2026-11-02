import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import {
  GIT_MODES,
  GIT_PROVIDERS,
  type GitCommitEntity,
  type GitConnectionEntity,
  type GitMode,
  type GitProviderKind,
} from '../entities/git.entity';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SECRET_REF = /^secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*$/;

/** Settings shared by create and update (3.29). */
class GitConnectionSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  path?: string;

  /** `secret://project/name`: a token, an SSH private key, or JSON `{ token, username, sshPrivateKey }`. */
  @IsOptional()
  @Matches(SECRET_REF)
  credentials?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  apiUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(65_536)
  caCertificate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(86_400)
  pollIntervalSeconds?: number | null;

  @IsOptional()
  @IsBoolean()
  webhook?: boolean;

  @IsOptional()
  @IsBoolean()
  approvalByMergeReview?: boolean;

  @IsOptional()
  @IsBoolean()
  membershipsFromGit?: boolean;

  @IsOptional()
  @IsBoolean()
  autoMerge?: boolean;

  @IsOptional()
  @IsBoolean()
  sops?: boolean;

  /** GitHub: use the cluster's GitHub App when the connection has no own token (cluster admins only). */
  @IsOptional()
  @IsBoolean()
  githubApp?: boolean;
}

export class CreateGitConnectionDto extends GitConnectionSettingsDto {
  /** Omitted: the cluster scope. */
  @IsOptional()
  @Matches(NAME)
  project?: string;

  @IsIn(GIT_PROVIDERS)
  provider!: GitProviderKind;

  @IsString()
  @MaxLength(2048)
  repoUrl!: string;

  @IsString()
  @MaxLength(200)
  branch!: string;

  @IsIn(GIT_MODES)
  mode!: GitMode;
}

/** `PATCH`: omitted fields stay; `null` only clears the optional ones (credentials, apiUrl, caCertificate, polling). */
export class UpdateGitConnectionDto extends GitConnectionSettingsDto {
  @IsOptional()
  @IsIn(GIT_PROVIDERS)
  provider?: GitProviderKind;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  repoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  branch?: string;

  @IsOptional()
  @IsIn(GIT_MODES)
  mode?: GitMode;
}

/** `POST /git/accounts/:provider/authorize` (3.41): a fleet console's return page, only through a trusted fleet. */
export class AuthorizeGitAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  returnUrl?: string;
}

export class ConfirmGitAccountDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,64}$/)
  nonce!: string;
}

export class ExportToRepoDto {
  /** Overwrite the resource files below a non-empty path. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export interface GitConnectionDto {
  id: string;
  /** null = the cluster scope. */
  project: string | null;
  provider: GitProviderKind;
  repoUrl: string;
  branch: string;
  path: string;
  mode: GitMode;
  credentials: string | null;
  apiUrl: string | null;
  caCertificate: string | null;
  pollIntervalSeconds: number | null;
  webhook: boolean;
  /** Where the provider sends webhooks (relative to the API base URL). */
  webhookPath: string;
  /** How often the webhook secret was rotated (0 = the original secret). */
  webhookGeneration: number;
  approvalByMergeReview: boolean;
  membershipsFromGit: boolean;
  autoMerge: boolean;
  sops: boolean;
  githubApp: boolean;
  /** The cluster's age recipient to encrypt SOPS files to (with `sops` enabled, once the identity exists). */
  sopsRecipient: string | null;
  hostKey: string | null;
  lastSyncedCommit: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toGitConnectionDto(c: GitConnectionEntity, sopsRecipient: string | null = null): GitConnectionDto {
  return {
    id: c.id,
    project: c.project,
    provider: c.provider,
    repoUrl: c.repoUrl,
    branch: c.branch,
    path: c.path,
    mode: c.mode,
    credentials: c.credentials,
    apiUrl: c.apiUrl,
    caCertificate: c.caCertificate,
    pollIntervalSeconds: c.pollIntervalSeconds,
    webhook: c.webhook,
    webhookPath: `/api/git/webhooks/${c.id}`,
    webhookGeneration: c.webhookGeneration ?? 0,
    approvalByMergeReview: c.approvalByMergeReview,
    membershipsFromGit: c.membershipsFromGit,
    autoMerge: c.autoMerge,
    sops: c.sops,
    githubApp: c.githubApp,
    sopsRecipient: c.sops ? sopsRecipient : null,
    hostKey: c.hostKey,
    lastSyncedCommit: c.lastSyncedCommit,
    lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    lastError: c.lastError,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export interface GitCommitDto {
  id: string;
  sha: string;
  ref: string;
  kind: GitCommitEntity['kind'];
  planId: string | null;
  author: string | null;
  message: string | null;
  state: GitCommitEntity['state'];
  reportedState: GitCommitEntity['reportedState'];
  reason: string | null;
  prUrl: string | null;
  prNumber: number | null;
  createdAt: string;
}

export function toGitCommitDto(c: GitCommitEntity): GitCommitDto {
  return {
    id: c.id,
    sha: c.sha,
    ref: c.ref,
    kind: c.kind,
    planId: c.planId,
    author: c.author,
    message: c.message,
    state: c.state,
    reportedState: c.reportedState,
    reason: c.reason,
    prUrl: c.prUrl,
    prNumber: c.prNumber,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Result of `POST /git/connections/:id/export`. */
export interface GitExportResultDto {
  commit: string | null;
  resources: number;
  changed: boolean;
  /** Resources read from SOPS-encrypted files: never exported in clear (their files are kept as they are). */
  skipped: string[];
}

/** Account linking waiting for the user's confirmation (`GET /git/accounts/pending/:nonce`). */
export interface GitPendingLinkDto {
  provider: 'github' | 'gitlab';
  login: string;
  providerUserId: string;
  expiresAt: string;
}

/** Result of a sync: what the branch head became. */
export interface GitSyncResultDto {
  commit: string | null;
  state: GitCommitEntity['state'] | 'unchanged' | 'error';
  planId: string | null;
  reason: string | null;
}
