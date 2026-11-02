import type { PlanResourceChange, PlanSource } from '../types/plans.types';
import type { GitConnection, GitProviderKind } from '../types/git.types';

/** A repository URL the control plane accepts: HTTPS or SSH (`ssh://` or scp-style). */
export interface GitRepoUrl {
  transport: 'https' | 'ssh';
  host: string;
  port: number | null;
  user: string | null;
  /** Repository path without leading `/` (e.g. `org/repo.git`). */
  path: string;
}

const HOST = /^([A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])$/;
const USER = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;
const SCP = /^([A-Za-z0-9._][A-Za-z0-9._-]{0,63})@([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\]):(.+)$/;
const REPO_PATH = /^[A-Za-z0-9._~%+/-]+$/;
const BRANCH =
  /^(?!-)(?!\/)(?!.*\/\/)(?!.*\.\.)(?!.*@\{)(?!.*\.lock(\/|$))(?!.*\/$)(?!.*\.$)(?!.*\/\.)(?!\.)[A-Za-z0-9._/-]{1,200}$/;
const DIR = /^[A-Za-z0-9._/-]{0,512}$/;
/** `secret://<project>/<name>`, as the API validates it. */
export const GIT_SECRET_REF = /^secret:\/\/([a-z0-9-]+)\/[a-z0-9][a-z0-9._-]*$/;

function repoPath(path: string): string | null {
  const clean = path.replace(/^\/+/, '');

  if (!clean || !REPO_PATH.test(clean) || clean.startsWith('-') || clean.split('/').some((s) => s === '..'))
    return null;

  return clean;
}

/**
 * Parses a repository URL like the control plane does (3.29): only `https://`, `ssh://` and scp-style
 * `user@host:path`, without credentials, query, fragment, whitespace or option-like input. null if it isn't one.
 */
export function parseGitRepoUrl(raw: string): GitRepoUrl | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;

  // eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected here
  if (/[\s\u0000-\u001f\u007f]/.test(raw) || raw.startsWith('-') || raw.includes('::')) return null;

  const lower = raw.toLowerCase();

  if (lower.startsWith('https://') || lower.startsWith('ssh://')) {
    let url: URL;

    try {
      url = new URL(raw);
    } catch {
      return null;
    }

    const transport = url.protocol === 'https:' ? 'https' : 'ssh';

    if (url.password || (transport === 'https' && url.username) || url.search || url.hash) return null;

    if (!HOST.test(url.hostname)) return null;

    let user: string | null = null;

    try {
      user = url.username ? decodeURIComponent(url.username) : null;
    } catch {
      return null;
    }

    if (user !== null && !USER.test(user)) return null;

    let path: string | null;

    try {
      path = repoPath(decodeURIComponent(url.pathname));
    } catch {
      return null;
    }

    return path ? { transport, host: url.hostname, port: url.port ? Number(url.port) : null, user, path } : null;
  }

  const scp = SCP.exec(raw);

  if (scp && !raw.includes('://')) {
    const [, user, host, rawPath] = scp;
    const path = repoPath(rawPath);

    return HOST.test(host) && path ? { transport: 'ssh', host, port: null, user, path } : null;
  }

  return null;
}

/** Whether Git accepts the branch name (restricted to a safe character set, like the API). */
export function isValidGitBranch(branch: string): boolean {
  return BRANCH.test(branch);
}

/** Whether a directory inside the repository is relative, without `..` or `.git` ('' = the root). */
export function isValidGitPath(path: string): boolean {
  const raw = path.trim();

  if (!DIR.test(raw) || raw.startsWith('/')) return false;

  return !raw
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .some((s) => s === '..' || s.toLowerCase() === '.git' || s.startsWith('-'));
}

/** The repository's web page on GitHub / GitLab / Gitea (null for plain Git or an unparseable URL). */
export function gitRepoWebUrl(connection: Pick<GitConnection, 'provider' | 'repoUrl'>): string | null {
  if (connection.provider === 'git') return null;

  const url = parseGitRepoUrl(connection.repoUrl);

  if (!url) return null;

  const port = url.transport === 'https' && url.port ? `:${url.port}` : '';
  const slug = url.path.replace(/\/+$/, '').replace(/\.git$/, '');

  return `https://${url.host}${port}/${slug}`;
}

/** A commit's page on the provider. */
export function gitCommitUrl(connection: Pick<GitConnection, 'provider' | 'repoUrl'>, sha: string): string | null {
  const base = gitRepoWebUrl(connection);

  if (!base || !/^[0-9a-f]{7,64}$/i.test(sha)) return null;

  return connection.provider === 'gitlab' ? `${base}/-/commit/${sha}` : `${base}/commit/${sha}`;
}

/** A pull / merge request's page on the provider. */
export function gitPullRequestUrl(
  connection: Pick<GitConnection, 'provider' | 'repoUrl'>,
  number: number,
): string | null {
  const base = gitRepoWebUrl(connection);

  if (!base || !Number.isInteger(number) || number <= 0) return null;

  switch (connection.provider as GitProviderKind) {
    case 'gitlab':
      return `${base}/-/merge_requests/${number}`;
    case 'gitea':
      return `${base}/pulls/${number}`;
    default:
      return `${base}/pull/${number}`;
  }
}

/** The first 8 characters of a commit SHA. */
export function shortSha(sha: string | null | undefined): string {
  return (sha ?? '').slice(0, 8);
}

/** `refs/heads/main` → `main`. */
export function shortRef(ref: string | null | undefined): string {
  return (ref ?? '').replace(/^refs\/(heads|tags)\//, '');
}

/**
 * The connection that carries a resource of `project` (null = cluster-level), per the scope rule (3.29): the
 * project's own connection, otherwise the cluster connection.
 */
export function gitCarrierOf<T extends Pick<GitConnection, 'project'>>(
  project: string | null | undefined,
  connections: readonly T[],
): T | null {
  return (
    (project ? connections.find((c) => c.project === project) : undefined) ??
    connections.find((c) => c.project === null) ??
    null
  );
}

/** Authoritative connections a set of changes touches (a UI / API plan there goes through a pull request). */
export function authoritativeConnectionsOf(
  changes: readonly Pick<PlanResourceChange, 'action' | 'project'>[],
  connections: readonly GitConnection[],
): GitConnection[] {
  const touched = new Map<string, GitConnection>();

  for (const change of changes) {
    if (change.action === 'unchanged') continue;

    const carrier = gitCarrierOf(change.project, connections);

    if (carrier?.mode === 'authoritative') touched.set(carrier.id, carrier);
  }

  return [...touched.values()];
}

/** Plans that came from Git or the system (fix-forward) aren't blocked by authoritative scopes. */
export function sourceBypassesGit(source: PlanSource | null | undefined): boolean {
  return source?.kind === 'git' || source?.kind === 'system';
}

/** The full webhook URL from the API URL (`…/api`) and the connection's `webhookPath` (`/api/git/webhooks/<id>`). */
export function gitWebhookUrl(restApi: string, webhookPath: string, base?: string): string {
  const api = restApi.replace(/\/+$/, '').replace(/\/api$/, '');
  const joined = `${api}${webhookPath.startsWith('/') ? '' : '/'}${webhookPath}`;

  try {
    return new URL(joined, base ?? (typeof document !== 'undefined' ? document.baseURI : undefined)).toString();
  } catch {
    return joined;
  }
}

/** The command that encrypts a file for the cluster (SOPS with the cluster's age recipient). */
export function sopsEncryptCommand(recipient: string, file = 'secrets.yaml'): string {
  return `sops --encrypt --age ${recipient} --in-place ${file}`;
}
