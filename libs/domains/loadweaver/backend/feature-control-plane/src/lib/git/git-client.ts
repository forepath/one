import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { assertBranch, parseRepoUrl } from './git-url.utils';

/** How Loadweaver authenticates against a repository; values only live in memory and the per-operation temp dir. */
export type GitAuth =
  | { kind: 'none' }
  /** HTTPS: sent as `Authorization: Basic base64(username:token)` through `http.extraHeader` (env, never argv). */
  | { kind: 'token'; username: string; token: string }
  /** SSH deploy key (OpenSSH or PEM private key). */
  | { kind: 'ssh'; privateKey: string };

export interface GitRemote {
  url: string;
  auth: GitAuth;
  /** Pinned SSH host keys (known_hosts lines); null / empty = trust on first use. */
  knownHosts?: string | null;
  /** PEM CA bundle for HTTPS behind a private CA. */
  caCertificate?: string | null;
}

export interface GitIdentity {
  name: string;
  email: string;
}

export interface GitClientOptions {
  identity: GitIdentity;
  binary?: string;
  /** Per git invocation. */
  timeoutMs?: number;
  /** stdout / stderr cap per invocation. */
  maxOutputBytes?: number;
  /** Largest file read from a checkout. */
  maxFileBytes?: number;
  /** Most YAML files listed from a checkout (other files don't count). */
  maxFiles?: number;
  /** Most directory entries walked when listing (any kind). */
  maxEntries?: number;
  /** Largest checkout (work tree + `.git`) after a clone / fetch. */
  maxRepoBytes?: number;
  /** Most bytes read from one checkout in total. */
  maxReadBytes?: number;
}

export type GitErrorCode = 'host-key-changed' | 'auth' | 'not-found' | 'rejected' | 'timeout' | 'failed';

/** A Git failure with a scrubbed message: no tokens, keys, headers, URL credentials or temp paths. */
export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface GitHeadInfo {
  sha: string;
  authorName: string;
  authorEmail: string;
  subject: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 4 * 1024 * 1024;
const DEFAULT_MAX_FILE = 1024 * 1024;
const DEFAULT_MAX_FILES = 5_000;
const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MAX_REPO_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_READ_BYTES = 32 * 1024 * 1024;
const YAML_FILE = /\.ya?ml$/i;
/** Temp dirs of Git operations are named like this; leftovers (a killed process) are swept at startup. */
const TEMP_PREFIX = 'lw-git-';
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The default Git identity of Loadweaver's commits (`LOADWEAVER_GIT_AUTHOR_NAME` / `_EMAIL`). */
export function gitIdentityFromEnv(env: NodeJS.ProcessEnv = process.env): GitIdentity {
  const clean = (value: string | undefined, fallback: string) =>
    // eslint-disable-next-line no-control-regex -- strip control characters from an identity
    (value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim() || fallback;

  return {
    name: clean(env['LOADWEAVER_GIT_AUTHOR_NAME'], 'Loadweaver'),
    email: clean(env['LOADWEAVER_GIT_AUTHOR_EMAIL'], 'loadweaver@localhost'),
  };
}

export function basicAuthHeader(username: string, token: string): string {
  return `Authorization: Basic ${Buffer.from(`${username}:${token}`, 'utf8').toString('base64')}`;
}

/** Removes every credential-like value from git / ssh output before it is shown or logged. */
export function scrubGitOutput(text: string, secrets: readonly string[], tempDir?: string): string {
  let out = text;

  for (const secret of secrets.filter((s) => s && s.length >= 4)) out = out.split(secret).join('***');

  if (tempDir) out = out.split(tempDir).join('<tmp>');

  return out
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***')
    .replace(/(authorization|private-token|x-gitlab-token)[ \t]*:[ \t]*\S+([ \t]+\S+)?/gi, '$1: ***')
    .replace(/:\/\/[^/@\s]+@/g, '://***@')
    .trim();
}

export function classifyGitError(stderr: string, pinned: boolean): GitErrorCode {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(stderr))
    return pinned ? 'host-key-changed' : 'auth';

  if (
    /\[rejected\]|\[remote rejected\]|non-fast-forward|fetch first|Updates were rejected|protected branch|pre-receive hook declined/i.test(
      stderr,
    )
  )
    return 'rejected';

  if (
    /Authentication failed|Permission denied|could not read Username|HTTP Basic: Access denied|returned error: 40[13]|invalid credentials/i.test(
      stderr,
    )
  )
    return 'auth';

  if (
    /Remote branch .* not found|Repository not found|not found|returned error: 404|does not appear to be a git repository/i.test(
      stderr,
    )
  )
    return 'not-found';

  return 'failed';
}

/** Total size of a directory tree (no symlinks followed); stops counting once `limit` is exceeded. */
export async function treeSize(dir: string, limit = Number.POSITIVE_INFINITY): Promise<number> {
  let total = 0;
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      if (total > limit) return;

      const full = join(path, entry.name);

      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) total += (await stat(full).catch(() => null))?.size ?? 0;
    }
  };

  await walk(dir);

  return total;
}

/**
 * Removes temp dirs of Git operations older than `olderThanMs` (left behind by a killed process); returns how many.
 * Called at startup, so only other processes' current operations (younger) are kept.
 */
export async function sweepStaleTempDirs(olderThanMs = 15 * 60_000, base = tmpdir()): Promise<number> {
  let removed = 0;

  for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue;

    const full = join(base, entry.name);
    const info = await lstat(full).catch(() => null);

    if (!info || Date.now() - info.mtimeMs < olderThanMs) continue;

    await rm(full, { recursive: true, force: true }).catch(() => undefined);
    removed++;
  }

  return removed;
}

/** Pull / merge request heads the plan bot may fetch. */
const PULL_REQUEST_REF = /^refs\/(pull\/[1-9][0-9]{0,8}\/head|merge-requests\/[1-9][0-9]{0,8}\/head)$/;

/** Quotes a value for the shell that runs `GIT_SSH_COMMAND`. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface Session {
  dir: string;
  repo: string;
  env: NodeJS.ProcessEnv;
  secrets: string[];
  knownHostsFile: string | null;
  pinned: boolean;
  /** Bytes read from the checkout so far (capped by `maxReadBytes`). */
  read: number;
}

/**
 * Builds the environment of one git invocation: no user / system config, no prompts, only HTTPS and SSH, the token as
 * an extra header (env, never argv or URL), the deploy key and pinned host key through `GIT_SSH_COMMAND`.
 */
export function gitEnvironment(input: {
  home: string;
  identity: GitIdentity;
  auth: GitAuth;
  keyFile?: string;
  knownHostsFile?: string;
  pinned?: boolean;
  caFile?: string;
  path?: string;
}): NodeJS.ProcessEnv {
  const config: [string, string][] = [
    ['protocol.allow', 'never'],
    ['protocol.https.allow', 'always'],
    ['protocol.ssh.allow', 'always'],
    ['http.followRedirects', 'false'],
    ['core.hooksPath', '/dev/null'],
    ['core.symlinks', 'false'],
    ['core.fsmonitor', 'false'],
    ['submodule.recurse', 'false'],
    ['commit.gpgSign', 'false'],
    ['init.defaultBranch', 'main'],
    ['user.name', input.identity.name],
    ['user.email', input.identity.email],
  ];

  if (input.auth.kind === 'token')
    config.push(['http.extraHeader', basicAuthHeader(input.auth.username, input.auth.token)]);

  if (input.caFile) config.push(['http.sslCAInfo', input.caFile]);

  const env: NodeJS.ProcessEnv = {
    PATH: input.path ?? process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: input.home,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'false',
    SSH_ASKPASS: 'false',
    GIT_ALLOW_PROTOCOL: 'https:ssh',
    GIT_PROTOCOL_FROM_USER: '0',
    GIT_AUTHOR_NAME: input.identity.name,
    GIT_AUTHOR_EMAIL: input.identity.email,
    GIT_COMMITTER_NAME: input.identity.name,
    GIT_COMMITTER_EMAIL: input.identity.email,
    GIT_CONFIG_COUNT: String(config.length),
  };

  config.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });

  const ssh = [
    'ssh',
    '-F',
    '/dev/null',
    ...(input.keyFile ? ['-i', shellQuote(input.keyFile), '-o', 'IdentitiesOnly=yes'] : []),
    '-o',
    'IdentityAgent=none',
    '-o',
    'BatchMode=yes',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    `UserKnownHostsFile=${shellQuote(input.knownHostsFile ?? '/dev/null')}`,
    '-o',
    'GlobalKnownHostsFile=/dev/null',
    '-o',
    `StrictHostKeyChecking=${input.pinned ? 'yes' : 'accept-new'}`,
    '-o',
    'HashKnownHosts=no',
    '-o',
    'UpdateHostKeys=no',
    '-o',
    'ConnectTimeout=20',
  ];

  env['GIT_SSH_COMMAND'] = ssh.join(' ');
  env['GIT_SSH_VARIANT'] = 'ssh';

  return env;
}

/**
 * Git over the CLI (3.29): `spawn` without a shell (own process group), a temp dir per operation (0700, always removed), shallow
 * fetches, timeouts and output limits, credentials only in the environment and the temp dir, scrubbed errors.
 */
export class GitClient {
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(private readonly options: GitClientOptions) {
    this.binary = options.binary ?? 'git';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  }

  /** The branch head on the remote (null if the branch doesn't exist) and the host keys seen on first contact. */
  async lsRemote(remote: GitRemote, branch: string): Promise<{ sha: string | null; knownHosts: string | null }> {
    const session = await this.session(remote);

    try {
      const out = await this.run(
        session,
        ['ls-remote', '--heads', '--', remote.url, `refs/heads/${assertBranch(branch)}`],
        session.dir,
      );
      const sha = out
        .split('\n')
        .map((l) => l.split('\t'))
        .find(([, ref]) => ref === `refs/heads/${branch}`)?.[0];

      return { sha: sha && SHA.test(sha) ? sha : null, knownHosts: await this.learnedHosts(session) };
    } finally {
      await rm(session.dir, { recursive: true, force: true });
    }
  }

  /**
   * A shallow checkout of a branch in a temp dir. A missing branch (or empty repository) gives an empty work tree on
   * that branch when `allowMissing` is set, so the first push creates it. The caller must `dispose()` it.
   */
  async open(remote: GitRemote, branch: string, options: { allowMissing?: boolean } = {}): Promise<GitWorkTree> {
    assertBranch(branch);

    const session = await this.session(remote);

    try {
      const head = await this.run(
        session,
        ['ls-remote', '--heads', '--', remote.url, `refs/heads/${branch}`],
        session.dir,
      );

      if (!head.trim()) {
        if (!options.allowMissing) throw new GitError('not-found', `branch ${branch} does not exist`);

        await this.run(session, ['init', '-q', '-b', branch, session.repo], session.dir);
        await this.run(session, ['remote', 'add', 'origin', remote.url], session.repo);
      } else {
        await this.run(
          session,
          [
            'clone',
            '-q',
            '--depth',
            '1',
            '--branch',
            branch,
            '--single-branch',
            '--no-tags',
            '--no-recurse-submodules',
            '--',
            remote.url,
            session.repo,
          ],
          session.dir,
        );
        await this.assertSize(session);
      }

      return new GitWorkTree(this, session, branch, await this.learnedHosts(session), this.options);
    } catch (error) {
      await rm(session.dir, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * A shallow, detached checkout of a pull / merge request head (`refs/pull/N/head`, `refs/merge-requests/N/head`,
   * plan bot 3.30). Nothing is ever pushed from it.
   */
  async openRef(remote: GitRemote, ref: string): Promise<GitWorkTree> {
    if (!PULL_REQUEST_REF.test(ref)) throw new GitError('failed', `invalid pull request ref ${ref}`);

    const session = await this.session(remote);

    try {
      await this.run(session, ['init', '-q', session.repo], session.dir);
      await this.run(session, ['remote', 'add', 'origin', remote.url], session.repo);
      await this.run(
        session,
        [
          'fetch',
          '-q',
          '--depth',
          '1',
          '--no-tags',
          '--no-recurse-submodules',
          'origin',
          `+${ref}:refs/remotes/origin/head`,
        ],
        session.repo,
      );
      await this.run(session, ['checkout', '-q', '--detach', 'refs/remotes/origin/head'], session.repo);
      await this.assertSize(session);

      return new GitWorkTree(this, session, 'detached', await this.learnedHosts(session), this.options);
    } catch (error) {
      await rm(session.dir, { recursive: true, force: true });
      throw error;
    }
  }

  /** A checkout larger than `maxRepoBytes` (work tree + objects) is refused (and removed by the caller). */
  private async assertSize(session: Session): Promise<void> {
    const max = this.options.maxRepoBytes ?? DEFAULT_MAX_REPO_BYTES;

    if ((await treeSize(session.repo, max)) > max)
      throw new GitError('failed', `the checkout is larger than ${Math.round(max / 1024 / 1024)} MiB`);
  }

  private async session(remote: GitRemote): Promise<Session> {
    parseRepoUrl(remote.url);

    const dir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));

    await chmod(dir, 0o700);

    const home = join(dir, 'home');

    await mkdir(home, { mode: 0o700 });

    const secrets: string[] = [];
    let keyFile: string | undefined;
    let caFile: string | undefined;
    const knownHostsFile = join(dir, 'known_hosts');
    const pinned = !!remote.knownHosts?.trim();

    await writeFile(knownHostsFile, pinned ? `${remote.knownHosts?.trim()}\n` : '', { mode: 0o600 });

    if (remote.auth.kind === 'token') {
      secrets.push(remote.auth.token, Buffer.from(`${remote.auth.username}:${remote.auth.token}`).toString('base64'));
    }

    if (remote.auth.kind === 'ssh') {
      keyFile = join(dir, 'id_key');
      await writeFile(keyFile, `${remote.auth.privateKey.trim()}\n`, { mode: 0o600 });
      secrets.push(remote.auth.privateKey);
    }

    if (remote.caCertificate) {
      caFile = join(dir, 'ca.pem');
      await writeFile(caFile, remote.caCertificate, { mode: 0o600 });
    }

    return {
      dir,
      repo: join(dir, 'repo'),
      secrets,
      knownHostsFile,
      pinned,
      read: 0,
      env: gitEnvironment({
        home,
        identity: this.options.identity,
        auth: remote.auth,
        keyFile,
        knownHostsFile,
        pinned,
        caFile,
      }),
    };
  }

  /** Host keys accepted on first contact (trust on first use); null when pinned or nothing was learned. */
  private async learnedHosts(session: Session): Promise<string | null> {
    if (session.pinned || !session.knownHostsFile) return null;

    const text = (await readFile(session.knownHostsFile, 'utf8').catch(() => '')).trim();

    return text || null;
  }

  /**
   * Runs git; stdout on success, a scrubbed `GitError` otherwise. Git runs in its own process group: on timeout (or
   * too much output) the whole group is killed, including the ssh / remote helpers git started.
   */
  async run(session: Session, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
    return await new Promise<string>((resolvePromise, reject) => {
      const child = spawn(this.binary, args, {
        cwd,
        env: { ...session.env, ...extraEnv },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      let failure: 'timeout' | 'output' | null = null;
      const killGroup = () => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      };
      const timer = setTimeout(() => {
        failure = 'timeout';
        killGroup();
      }, this.timeoutMs);
      const collect = (into: Buffer[]) => (chunk: Buffer) => {
        size += chunk.length;

        if (size > this.maxOutputBytes) {
          failure ??= 'output';
          killGroup();

          return;
        }

        into.push(chunk);
      };

      child.stdout.on('data', collect(stdout));
      child.stderr.on('data', collect(stderr));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(
          new GitError(
            'failed',
            `git ${args[0]} failed: ${scrubGitOutput(error.message, session.secrets, session.dir)}`,
          ),
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);

        const out = Buffer.concat(stdout).toString('utf8');

        if (code === 0 && !failure) {
          resolvePromise(out);

          return;
        }

        // A git that exited may leave helpers behind (a hung ssh); the group goes with it.
        killGroup();

        const err = Buffer.concat(stderr).toString('utf8');
        // `push --porcelain` reports ref rejections on stdout.
        const output = [err, args[0] === 'push' ? out : ''].filter(Boolean).join('\n') || `exit code ${code}`;
        const detail = scrubGitOutput(output, session.secrets, session.dir)
          .split('\n')
          .filter((l) => l.trim())
          .slice(-6)
          .join('; ')
          .slice(0, 600);

        reject(
          new GitError(
            failure === 'timeout'
              ? 'timeout'
              : failure === 'output'
                ? 'failed'
                : classifyGitError(output, session.pinned),
            failure === 'timeout'
              ? `git ${args[0]} timed out`
              : failure === 'output'
                ? `git ${args[0]} produced more than ${this.maxOutputBytes} bytes of output`
                : `git ${args[0]} failed: ${detail || 'unknown error'}`,
          ),
        );
      });
    });
  }
}

/** A checkout in a temp dir: read / write files below the root, commit, push; `dispose()` removes everything. */
export class GitWorkTree {
  private disposed = false;
  private readonly written = new Set<string>();

  constructor(
    private readonly client: GitClient,
    private readonly session: Session,
    readonly branch: string,
    /** Host keys learned on first contact (to be pinned on the connection). */
    readonly learnedHostKeys: string | null,
    private readonly options: GitClientOptions,
  ) {}

  get dir(): string {
    return this.session.repo;
  }

  /** The checked-out commit; null for a new (empty) branch. */
  async head(): Promise<GitHeadInfo | null> {
    try {
      const out = await this.client.run(
        this.session,
        ['log', '-1', '--format=%H%x00%an%x00%ae%x00%s'],
        this.session.repo,
      );
      const [sha, authorName, authorEmail, subject] = out.trim().split('\0');

      return SHA.test(sha ?? '') ? { sha, authorName, authorEmail, subject: subject ?? '' } : null;
    } catch {
      return null;
    }
  }

  private resolveInside(path: string): string {
    const full = resolve(this.session.repo, path);
    const rel = relative(this.session.repo, full);

    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.split(sep)[0] === '.git')
      throw new GitError('failed', `path ${path} is outside the work tree`);

    return full;
  }

  /**
   * Regular files below `base` (repository-relative, `/`-separated); `.git` and symlinks are skipped. Only YAML files
   * count toward `maxFiles` (other files in the repository don't fail a sync); the walk itself is bounded too.
   */
  async listFiles(base = ''): Promise<string[]> {
    const max = this.options.maxFiles ?? DEFAULT_MAX_FILES;
    const maxEntries = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const root = base ? this.resolveInside(base) : this.session.repo;
    const files: string[] = [];
    let yaml = 0;
    let entriesSeen = 0;
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === '.git') continue;

        if (++entriesSeen > maxEntries) throw new GitError('failed', `more than ${maxEntries} entries below the path`);

        const full = join(dir, entry.name);

        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) {
          files.push(relative(this.session.repo, full).split(sep).join('/'));

          if (YAML_FILE.test(entry.name) && ++yaml > max)
            throw new GitError('failed', `more than ${max} YAML files below the path`);
        }
      }
    };

    await walk(root);

    return files;
  }

  async readFile(path: string): Promise<Buffer> {
    const full = this.resolveInside(path);
    const info = await lstat(full);
    const max = this.options.maxFileBytes ?? DEFAULT_MAX_FILE;

    if (!info.isFile()) throw new GitError('failed', `${path} is not a regular file`);

    if (info.size > max) throw new GitError('failed', `${path} is larger than ${max} bytes`);

    const maxRead = this.options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;

    if (this.session.read + info.size > maxRead)
      throw new GitError('failed', `more than ${maxRead} bytes read from the checkout`);

    this.session.read += info.size;

    return await readFile(full);
  }

  async exists(path: string): Promise<boolean> {
    return await lstat(this.resolveInside(path))
      .then((s) => s.isFile())
      .catch(() => false);
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    const full = this.resolveInside(path);

    await mkdir(dirname(full), { recursive: true });

    const existing = await lstat(full).catch(() => null);

    if (existing && !existing.isFile()) throw new GitError('failed', `${path} is not a regular file`);

    await writeFile(full, content);
    this.written.add(relative(this.session.repo, full).split(sep).join('/'));
  }

  /** Files written through this tree (repository-relative), with their current content (the secret scan's input). */
  async writtenFiles(): Promise<{ path: string; text: string }[]> {
    const files: { path: string; text: string }[] = [];

    for (const path of [...this.written].sort()) {
      const full = this.resolveInside(path);

      if (
        await lstat(full)
          .then((s) => s.isFile())
          .catch(() => false)
      )
        files.push({ path, text: (await readFile(full)).toString('utf8') });
    }

    return files;
  }

  async removeFile(path: string): Promise<void> {
    await rm(this.resolveInside(path), { force: true });
  }

  /** Stages everything and commits; null when nothing changed. The committer is Loadweaver's identity. */
  async commit(message: string): Promise<string | null> {
    const run = (args: string[]) => this.client.run(this.session, args, this.session.repo);

    await run(['add', '-A']);

    const status = await run(['status', '--porcelain']);

    if (!status.trim()) return null;

    await run(['commit', '-q', '--no-verify', '-m', message.slice(0, 2000)]);

    return (await run(['rev-parse', 'HEAD'])).trim();
  }

  /** Pushes HEAD to a branch of the remote (no force). */
  async push(branch: string = this.branch): Promise<void> {
    await this.client.run(
      this.session,
      ['push', '--porcelain', '--no-verify', 'origin', `HEAD:refs/heads/${assertBranch(branch)}`],
      this.session.repo,
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;

    this.disposed = true;
    await rm(this.session.dir, { recursive: true, force: true });
  }
}
