import {
  GIT_SECRET_REF,
  isValidGitBranch,
  isValidGitPath,
  parseGitRepoUrl,
  type AccessMe,
  type CreateGitConnectionRequest,
  type GitAccountProvider,
  type GitCommitKind,
  type GitCommitState,
  type GitConnection,
  type GitMode,
  type GitProviderKind,
  type PlanSourceKind,
  type UpdateGitConnectionRequest,
} from '@forepath/loadweaver/frontend/data-access-console';

import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';

import { projectRoleOf } from '../access/access-format';

type Tone = FpcBadgeTone;

/** Polling bounds of the API (seconds). */
export const GIT_POLL_MIN = 10;
export const GIT_POLL_MAX = 86_400;

export function gitProviderLabel(provider: GitProviderKind | GitAccountProvider): string {
  switch (provider) {
    case 'github':
      return 'GitHub';
    case 'gitlab':
      return 'GitLab';
    case 'gitea':
      return 'Gitea / Forgejo';
    default:
      return $localize`:@@lwConsoleGit-providerPlain:Plain Git`;
  }
}

export const GIT_PROVIDER_ICON: Record<GitProviderKind, string> = {
  github: 'bi-github',
  gitlab: 'bi-gitlab',
  gitea: 'bi-git',
  git: 'bi-git',
};

export function gitModeLabel(mode: GitMode): string {
  return mode === 'authoritative'
    ? $localize`:@@lwConsoleGit-modeAuthoritative:Git is authoritative`
    : $localize`:@@lwConsoleGit-modeBidirectional:Bidirectional`;
}

export function gitModeHint(mode: GitMode): string {
  return mode === 'authoritative'
    ? $localize`:@@lwConsoleGit-modeAuthoritativeHint:Changes are applied only through Git. Edits in the console or the API open a pull request; merging it creates the plan to apply.`
    : $localize`:@@lwConsoleGit-modeBidirectionalHint:Edits in the console or the API are applied as usual and then committed back to the branch.`;
}

export function gitScopeLabel(project: string | null): string {
  return project ?? $localize`:@@lwConsoleGit-scopeCluster:Cluster scope`;
}

export const GIT_COMMIT_STATE_TONE: Record<GitCommitState, Tone> = {
  pending: 'info',
  approved: 'info',
  applying: 'primary',
  applied: 'success',
  failed: 'danger',
  discarded: 'neutral',
  rejected: 'danger',
  'no-changes': 'neutral',
  synced: 'success',
};

export function gitCommitStateLabel(state: GitCommitState): string {
  switch (state) {
    case 'pending':
      return $localize`:@@lwConsoleGit-statePending:Plan pending`;
    case 'approved':
      return $localize`:@@lwConsoleGit-stateApproved:Plan approved`;
    case 'applying':
      return $localize`:@@lwConsoleGit-stateApplying:Applying`;
    case 'applied':
      return $localize`:@@lwConsoleGit-stateApplied:Applied`;
    case 'failed':
      return $localize`:@@lwConsoleGit-stateFailed:Failed`;
    case 'discarded':
      return $localize`:@@lwConsoleGit-stateDiscarded:Discarded`;
    case 'rejected':
      return $localize`:@@lwConsoleGit-stateRejected:Rejected`;
    case 'no-changes':
      return $localize`:@@lwConsoleGit-stateNoChanges:No changes`;
    default:
      return $localize`:@@lwConsoleGit-stateSynced:Synced`;
  }
}

export function gitCommitKindLabel(kind: GitCommitKind): string {
  switch (kind) {
    case 'push':
      return $localize`:@@lwConsoleGit-kindPush:Push`;
    case 'commit-back':
      return $localize`:@@lwConsoleGit-kindCommitBack:Commit-back`;
    case 'export':
      return $localize`:@@lwConsoleGit-kindExport:Export`;
    default:
      return $localize`:@@lwConsoleGit-kindPlanBranch:Pull request branch`;
  }
}

export function planSourceLabel(kind: PlanSourceKind): string {
  switch (kind) {
    case 'git':
      return $localize`:@@lwConsoleGit-sourceGit:Git`;
    case 'ui':
      return $localize`:@@lwConsoleGit-sourceUi:Console`;
    case 'api':
      return $localize`:@@lwConsoleGit-sourceApi:API`;
    case 'drift':
      return $localize`:@@lwConsoleGit-sourceDrift:Drift`;
    default:
      return $localize`:@@lwConsoleGit-sourceSystem:System`;
  }
}

export const PLAN_SOURCE_ICON: Record<PlanSourceKind, string> = {
  git: 'bi-git',
  ui: 'bi-window',
  api: 'bi-code-slash',
  drift: 'bi-shuffle',
  system: 'bi-gear',
};

/**
 * Cluster admins manage the cluster connection, project admins their project's (cluster admins: every project). In
 * fleet mode (3.41) project admins without the cluster-wide admin grant act as the signed person, so only when the
 * cluster verifies this fleet's identity (`me.fleetIdentity`); cluster-wide admins work as before.
 */
export function mayAdministerGitScope(
  me: AccessMe | null | undefined,
  project: string | null,
  fleetMode = false,
): boolean {
  if (!me) return false;

  if (me.clusterRole === 'cluster-admin') return true;

  return project !== null && projectRoleOf(me, project) === 'admin' && (!fleetMode || !!me.fleetIdentity);
}

/**
 * What a fleet grant can't do on the Git pages without the cluster verifying this fleet's identity (3.41), or null:
 * `read` — project grants only, the list itself needs the person; `manage` — reads work (a cluster-wide grant), but
 * the caller's project admin roles need the person.
 */
export function gitFleetIdentityGap(fleetMode: boolean, me: AccessMe | null | undefined): 'read' | 'manage' | null {
  if (!fleetMode || !me || me.fleetIdentity || me.clusterRole === 'cluster-admin') return null;

  if (!me.clusterRole) return Object.keys(me.projects).length > 0 ? 'read' : null;

  return Object.keys(me.projects).some((p) => projectRoleOf(me, p) === 'admin') ? 'manage' : null;
}

/** The form behind create / edit. Numbers stay strings while typed. */
export interface GitConnectionForm {
  /** '' = the cluster scope. */
  scope: string;
  provider: GitProviderKind;
  repoUrl: string;
  branch: string;
  path: string;
  mode: GitMode;
  credentials: string;
  apiUrl: string;
  caCertificate: string;
  webhook: boolean;
  polling: boolean;
  pollIntervalSeconds: string;
  approvalByMergeReview: boolean;
  membershipsFromGit: boolean;
  autoMerge: boolean;
  sops: boolean;
  /** GitHub: use the cluster's GitHub App without an own token (cluster admins only). */
  githubApp: boolean;
}

export type GitFormField =
  | 'scope'
  | 'repoUrl'
  | 'branch'
  | 'path'
  | 'credentials'
  | 'apiUrl'
  | 'caCertificate'
  | 'trigger';

export function emptyGitForm(scope = ''): GitConnectionForm {
  return {
    scope,
    provider: 'github',
    repoUrl: '',
    branch: 'main',
    path: scope,
    mode: 'bidirectional',
    credentials: '',
    apiUrl: '',
    caCertificate: '',
    webhook: true,
    polling: true,
    pollIntervalSeconds: '60',
    approvalByMergeReview: false,
    membershipsFromGit: false,
    autoMerge: true,
    sops: false,
    githubApp: false,
  };
}

export function gitFormOf(connection: GitConnection): GitConnectionForm {
  return {
    scope: connection.project ?? '',
    provider: connection.provider,
    repoUrl: connection.repoUrl,
    branch: connection.branch,
    path: connection.path,
    mode: connection.mode,
    credentials: connection.credentials ?? '',
    apiUrl: connection.apiUrl ?? '',
    caCertificate: connection.caCertificate ?? '',
    webhook: connection.webhook,
    polling: connection.pollIntervalSeconds !== null,
    pollIntervalSeconds: String(connection.pollIntervalSeconds ?? 60),
    approvalByMergeReview: connection.approvalByMergeReview,
    membershipsFromGit: connection.membershipsFromGit,
    autoMerge: connection.autoMerge,
    sops: connection.sops,
    githubApp: connection.githubApp === true,
  };
}

/** What is wrong with the form (empty: nothing), mirroring the API's checks. */
export function validateGitForm(form: GitConnectionForm, scopes?: readonly string[]): GitFormField[] {
  const invalid: GitFormField[] = [];
  const url = parseGitRepoUrl(form.repoUrl.trim());
  const credentials = form.credentials.trim();
  const ref = credentials ? GIT_SECRET_REF.exec(credentials) : null;
  const apiUrl = form.apiUrl.trim();
  const ca = form.caCertificate.trim();
  const poll = Number(form.pollIntervalSeconds);

  if (scopes && !scopes.includes(form.scope)) invalid.push('scope');

  if (!url) invalid.push('repoUrl');

  if (!isValidGitBranch(form.branch.trim())) invalid.push('branch');

  if (!isValidGitPath(form.path)) invalid.push('path');

  // SSH needs a deploy key; a project's connection only uses its own secrets (the token goes to the configured host).
  if (
    (credentials && !ref) ||
    (url?.transport === 'ssh' && !credentials) ||
    (ref && form.scope !== '' && ref[1] !== form.scope)
  )
    invalid.push('credentials');

  if (apiUrl) {
    let ok = false;

    try {
      const parsed = new URL(apiUrl);

      ok = parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
    } catch {
      ok = false;
    }

    if (!ok || form.provider === 'git') invalid.push('apiUrl');
  }

  if (ca && (!/-----BEGIN CERTIFICATE-----/.test(ca) || /PRIVATE KEY/.test(ca))) invalid.push('caCertificate');

  if (
    (!form.webhook && !form.polling) ||
    (form.polling && (!Number.isInteger(poll) || poll < GIT_POLL_MIN || poll > GIT_POLL_MAX))
  )
    invalid.push('trigger');

  return invalid;
}

/** The create request from a valid form. */
export function createRequestOf(form: GitConnectionForm): CreateGitConnectionRequest {
  return {
    ...(form.scope ? { project: form.scope } : {}),
    provider: form.provider,
    repoUrl: form.repoUrl.trim(),
    branch: form.branch.trim(),
    mode: form.mode,
    path: form.path.trim(),
    credentials: form.credentials.trim() || null,
    apiUrl: form.provider === 'git' ? null : form.apiUrl.trim() || null,
    caCertificate: form.caCertificate.trim() || null,
    webhook: form.webhook,
    pollIntervalSeconds: form.polling ? Number(form.pollIntervalSeconds) : null,
    approvalByMergeReview: form.approvalByMergeReview,
    membershipsFromGit: form.membershipsFromGit,
    autoMerge: form.autoMerge,
    sops: form.sops,
    // Only GitHub connections use the app.
    githubApp: form.provider === 'github' && form.githubApp,
  };
}

/** The update request: only what changed (the API resyncs on another URL, branch or path). */
export function updateRequestOf(form: GitConnectionForm, connection: GitConnection): UpdateGitConnectionRequest {
  const next = createRequestOf(form);
  const before = createRequestOf(gitFormOf(connection));
  const changed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(next)) {
    if (key === 'project') continue;

    if (JSON.stringify(value) !== JSON.stringify(before[key as keyof CreateGitConnectionRequest])) changed[key] = value;
  }

  return changed as UpdateGitConnectionRequest;
}

/**
 * The control plane turns the GitHub App off when someone other than a cluster admin points the connection elsewhere
 * (repository, API URL or provider): the app's token reaches whatever repository is configured.
 */
export function githubAppResetByEdit(
  form: GitConnectionForm,
  connection: GitConnection | null,
  clusterAdmin: boolean,
): boolean {
  if (!connection?.githubApp || clusterAdmin) return false;

  return (
    form.repoUrl.trim() !== connection.repoUrl ||
    (form.provider === 'git' ? null : form.apiUrl.trim() || null) !== connection.apiUrl ||
    form.provider !== connection.provider
  );
}

/** The header that carries the webhook secret, per provider. */
export function webhookSecretHint(provider: GitProviderKind): string {
  return provider === 'gitlab'
    ? $localize`:@@lwConsoleGit-webhookGitlab:GitLab: enter the secret as the webhook's secret token (sent as X-Gitlab-Token).`
    : $localize`:@@lwConsoleGit-webhookSigned:Enter the secret as the webhook secret; the provider signs every delivery with it (X-Hub-Signature-256), content type application/json, push events.`;
}
