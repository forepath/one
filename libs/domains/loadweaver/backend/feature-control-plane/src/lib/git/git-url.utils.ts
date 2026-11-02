import type { GitProviderKind } from '../entities/git.entity';

/** A repository URL Loadweaver accepts: HTTPS or SSH (`ssh://` or scp-style), nothing local or exotic. */
export interface RepoUrl {
  transport: 'https' | 'ssh';
  /** Host name or bracketed IPv6 literal. */
  host: string;
  port: number | null;
  user: string | null;
  /** Repository path without leading `/` (e.g. `org/repo.git`). */
  path: string;
}

export class GitUrlError extends Error {}

const HOST = /^([A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])$/;
const USER = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;
const SCP = /^([A-Za-z0-9._][A-Za-z0-9._-]{0,63})@([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\]):(.+)$/;
const REPO_PATH = /^[A-Za-z0-9._~%+/-]+$/;
/** Branch names Git accepts (check-ref-format), restricted to a safe character set. */
const BRANCH =
  /^(?!-)(?!\/)(?!.*\/\/)(?!.*\.\.)(?!.*@\{)(?!.*\.lock(\/|$))(?!.*\/$)(?!.*\.$)(?!.*\/\.)(?!\.)[A-Za-z0-9._/-]{1,200}$/;
const DIR = /^[A-Za-z0-9._/-]{0,512}$/;

function assertRepoPath(path: string): string {
  const clean = path.replace(/^\/+/, '');

  if (!clean || !REPO_PATH.test(clean) || clean.startsWith('-') || clean.split('/').some((s) => s === '..'))
    throw new GitUrlError('invalid repository path');

  return clean;
}

/**
 * Parses and validates a repository URL (3.29). Only `https://`, `ssh://` and scp-style `user@host:path` are
 * accepted: no `file://`, `ext::`, `git://`, plain HTTP, local paths, credentials in the URL, whitespace or anything
 * that looks like a command-line option.
 */
export function parseRepoUrl(raw: string): RepoUrl {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) throw new GitUrlError('invalid repository URL');

  // eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected here
  if (/[\s\u0000-\u001f\u007f]/.test(raw) || raw.startsWith('-') || raw.includes('::'))
    throw new GitUrlError('invalid repository URL');

  const lower = raw.toLowerCase();

  if (lower.startsWith('https://') || lower.startsWith('ssh://')) {
    let url: URL;

    try {
      url = new URL(raw);
    } catch {
      throw new GitUrlError('invalid repository URL');
    }

    const transport = url.protocol === 'https:' ? 'https' : 'ssh';

    if (url.password || (transport === 'https' && url.username))
      throw new GitUrlError('credentials do not belong in the repository URL; use a secret reference');

    if (url.search || url.hash) throw new GitUrlError('the repository URL must not have a query or fragment');

    const host = url.hostname;

    if (!HOST.test(host)) throw new GitUrlError('invalid repository host');

    if (url.username && !USER.test(decodeURIComponent(url.username))) throw new GitUrlError('invalid SSH user');

    return {
      transport,
      host,
      port: url.port ? Number(url.port) : null,
      user: url.username ? decodeURIComponent(url.username) : null,
      path: assertRepoPath(decodeURIComponent(url.pathname)),
    };
  }

  const scp = SCP.exec(raw);

  if (scp && !raw.includes('://')) {
    const [, user, host, path] = scp;

    if (!HOST.test(host)) throw new GitUrlError('invalid repository host');

    return { transport: 'ssh', host, port: null, user, path: assertRepoPath(path) };
  }

  throw new GitUrlError('only https:// and ssh:// (or user@host:path) repository URLs are supported');
}

export function assertBranch(branch: string): string {
  if (typeof branch !== 'string' || !BRANCH.test(branch)) throw new GitUrlError('invalid branch name');

  return branch;
}

/** A directory inside the repository: relative, normalized, without `..` or `.git` ('' = root). */
export function normalizeRepoDir(path: string | undefined | null): string {
  const raw = (path ?? '').trim();

  if (!DIR.test(raw)) throw new GitUrlError('invalid path');

  const segments = raw.split('/').filter((s) => s !== '' && s !== '.');

  if (raw.startsWith('/') || segments.some((s) => s === '..' || s.toLowerCase() === '.git' || s.startsWith('-')))
    throw new GitUrlError('the path must be relative, without .. or .git');

  return segments.join('/');
}

/** `org/repo` from a repository path (`org/repo.git`, `group/sub/repo`). */
export function repoSlug(url: RepoUrl): string {
  return url.path.replace(/\/+$/, '').replace(/\.git$/, '');
}

/** The provider API base: configured, or derived from the repository host. */
export function providerApiBase(provider: GitProviderKind, url: RepoUrl, configured?: string | null): string | null {
  if (provider === 'git') return null;

  if (configured) {
    const parsed = new URL(configured);

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new GitUrlError('the API URL must be https:// without credentials, query or fragment');

    return configured.replace(/\/+$/, '');
  }

  const origin = `https://${url.host}${url.transport === 'https' && url.port ? `:${url.port}` : ''}`;

  switch (provider) {
    case 'github':
      return url.host.toLowerCase() === 'github.com' ? 'https://api.github.com' : `${origin}/api/v3`;
    case 'gitlab':
      return `${origin}/api/v4`;
    case 'gitea':
      return `${origin}/api/v1`;
  }
}

/** `DnsRecord` → `dns-record`. */
export function kindFileName(kind: string): string {
  return kind.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Where a resource without a synced file is written: `<path>/<project|cluster>/<kind>-<name>.yaml`. */
export function defaultResourcePath(base: string, kind: string, name: string, project: string | null): string {
  return [base, project ?? 'cluster', `${kindFileName(kind)}-${name}.yaml`].filter(Boolean).join('/');
}

/** Whether a repository file is below the connection's path. */
export function underPath(file: string, base: string): boolean {
  return base === '' || file.startsWith(`${base}/`);
}
