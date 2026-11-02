import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import {
  KOPIA_CONTROL_USER,
  KOPIA_GLOBAL_POLICY_ARGS,
  kopiaPasswordHash,
} from '@forepath/loadweaver/shared/util-agent-protocol';

/**
 * The control plane's Kopia client (3.20): retention, catalog, diff, file browsing, user management and secondary
 * copies run as the control plane's user (FULL) against the repository servers, or — for `sync-to` — directly on
 * the object store. Every operation gets its own throw-away config / cache directory; passwords travel in the
 * environment only. The binary comes with the control-plane image (`kopia` from the pinned image);
 * `LOADWEAVER_KOPIA_COMMAND` (JSON array, e.g. a `docker run … kopia/kopia` prefix) overrides it for tests.
 */

export const KOPIA_COMMAND_ENV = 'LOADWEAVER_KOPIA_COMMAND';
const TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT = 64 * 1024 * 1024;

export type KopiaConnection =
  | {
      kind: 'server';
      servers: Array<{ address: string; port: number }>;
      fingerprint: string;
      username: string;
      hostname: string;
      password: string;
    }
  | {
      kind: 's3';
      endpoint: string;
      bucket: string;
      prefix: string;
      accessKeyId: string;
      secretAccessKey: string;
      password: string;
    };

export interface KopiaSnapshot {
  id: string;
  source: { host: string; userName: string; path: string };
  description?: string;
  startTime: string;
  endTime: string;
  rootEntry: { obj: string; summ?: { size?: number; files?: number } };
  stats?: { totalSize?: number; fileCount?: number };
  tags?: Record<string, string>;
}

export interface KopiaListEntry {
  name: string;
  directory: boolean;
  mode: string;
  size: number;
  modified: string;
  object: string;
}

export interface KopiaDiff {
  added: Array<{ path: string; size: number | null; directory: boolean }>;
  removed: Array<{ path: string; size: number | null; directory: boolean }>;
  changed: Array<{ path: string; before: number | null; after: number | null }>;
  stats: Record<string, unknown> | null;
}

export class KopiaError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export function kopiaCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[KOPIA_COMMAND_ENV];

  if (!raw) return ['kopia'];

  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((p) => typeof p === 'string'))
    throw new Error(`${KOPIA_COMMAND_ENV} must be a JSON array of strings`);

  return parsed as string[];
}

function hostPort(address: string, port: number): string {
  return `${address.includes(':') ? `[${address}]` : address}:${port}`;
}

/** Last lines of Kopia's stderr without secrets (Kopia never prints passwords, but keep it short). */
function tail(text: string): string {
  return text.trim().split('\n').slice(-4).join(' | ').slice(0, 1024);
}

/** Parses `kopia ls -l` output. */
export function parseKopiaList(output: string): KopiaListEntry[] {
  const entries: KopiaListEntry[] = [];

  for (const line of output.split('\n')) {
    const match = /^(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \S+)\s+(\S+)\s+(.+)$/.exec(line.trim());

    if (!match) continue;

    const directory = match[1].startsWith('d');
    const name = directory ? match[5].replace(/\/$/, '') : match[5];

    entries.push({ name, directory, mode: match[1], size: Number(match[2]), modified: match[3], object: match[4] });
  }

  return entries;
}

/** Parses `kopia diff <a> <b>` output (without `--files`). */
export function parseKopiaDiff(output: string): KopiaDiff {
  const diff: KopiaDiff = { added: [], removed: [], changed: [], stats: null };
  const jsonStart = output.lastIndexOf('{"fileEntries"');

  if (jsonStart >= 0) {
    try {
      diff.stats = JSON.parse(output.slice(jsonStart)) as Record<string, unknown>;
    } catch {
      diff.stats = null;
    }
  }

  const text = jsonStart >= 0 ? output.slice(0, jsonStart) : output;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const entry = /^(added|removed) (file|directory) \.\/(.+?)(?: \((\d+) bytes\))?$/.exec(trimmed);

    if (entry) {
      const item = { path: entry[3], size: entry[4] ? Number(entry[4]) : null, directory: entry[2] === 'directory' };

      (entry[1] === 'added' ? diff.added : diff.removed).push(item);
      continue;
    }

    const changed = /^changed \.\/(.+?) at .*?\(size (\d+) -> (\d+)\)$/.exec(trimmed);

    if (changed) diff.changed.push({ path: changed[1], before: Number(changed[2]), after: Number(changed[3]) });
  }

  return diff;
}

/**
 * The manifest `kopia snapshot create --json` prints (one JSON document; log lines before it are skipped).
 * Throws when no snapshot with a root object is found.
 */
export function parseKopiaSnapshotCreate(output: string): KopiaSnapshot {
  const trimmed = output.trim();
  const candidates = [trimmed, trimmed.slice(trimmed.indexOf('{'))];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as KopiaSnapshot | KopiaSnapshot[];
      const snapshot = Array.isArray(parsed) ? parsed.at(-1) : parsed;

      if (snapshot?.id && snapshot.rootEntry?.obj) return snapshot;
    } catch {
      // try the next candidate
    }
  }

  throw new KopiaError('kopia snapshot create returned no snapshot', tail(output));
}

/** A policy without its empty sections (`{}`, `[]`); `undefined` when nothing is set. */
export function meaningfulPolicy(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? value : undefined;

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, meaningfulPolicy(v)] as const)
      .filter(([, v]) => v !== undefined);

    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  return value;
}

/** The only source policy a node writes itself: Kopia marks stdin sources (VM disks, block volumes) `manual`. */
export const KOPIA_SOURCE_POLICY = { scheduling: { manual: true } } as const;

/** Global retention / compression the repository servers set (`KOPIA_GLOBAL_POLICY_ARGS`), as `policy export` shows them. */
export function expectedGlobalPolicy(): { retention: Record<string, number>; compression: { compressorName: string } } {
  const retention: Record<string, number> = {};
  let compressorName = '';

  for (let i = 0; i < KOPIA_GLOBAL_POLICY_ARGS.length; i += 2) {
    const flag = KOPIA_GLOBAL_POLICY_ARGS[i].replace(/^--/, '');
    const value = KOPIA_GLOBAL_POLICY_ARGS[i + 1];

    if (flag === 'compression') compressorName = value;
    else retention[flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = Number(value);
  }

  return { retention, compression: { compressorName } };
}

function sameJson(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : v;

  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export interface KopiaPolicyDrift {
  /** Source policies (`user@host:path`, `user@host`, `@host`) with more than the `manual` flag, as found. */
  sources: Array<{ target: string; policy: unknown }>;
  /** The global retention / compression differs from the servers' setting. */
  global: boolean;
}

/**
 * What `kopia policy export` shows beyond the expected policies (user decision 2026-10-27): nodes may write their own
 * source policies (FULL, for the `manual` flag), so anything else there — e.g. a shortened retention — is drift.
 */
export function kopiaPolicyDrift(exported: Record<string, unknown>): KopiaPolicyDrift {
  const sources: KopiaPolicyDrift['sources'] = [];
  let global = false;

  for (const [target, policy] of Object.entries(exported)) {
    const set = meaningfulPolicy(policy);

    if (target === '(global)') {
      const expected = expectedGlobalPolicy();
      const current = (set ?? {}) as { retention?: Record<string, unknown>; compression?: unknown };
      const retention = Object.fromEntries(
        Object.keys(expected.retention).map((k) => [k, current.retention?.[k] ?? 0]),
      );

      global = !sameJson(retention, expected.retention) || !sameJson(current.compression, expected.compression);
      continue;
    }

    if (set !== undefined && !sameJson(set, KOPIA_SOURCE_POLICY)) sources.push({ target, policy: set });
  }

  return { sources, global };
}

export class KopiaCli {
  constructor(private readonly command: string[] = kopiaCommand()) {}

  private env(dir: string, password: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: dir,
      KOPIA_CONFIG_PATH: join(dir, 'repository.config'),
      KOPIA_CACHE_DIRECTORY: join(dir, 'cache'),
      KOPIA_LOG_DIR: join(dir, 'logs'),
      KOPIA_CHECK_FOR_UPDATES: 'false',
      KOPIA_PERSIST_CREDENTIALS_ON_CONNECT: 'false',
      KOPIA_PASSWORD: password,
      ...extra,
    };
  }

  private run(args: string[], env: NodeJS.ProcessEnv, timeoutMs = TIMEOUT_MS): Promise<string> {
    const [bin, ...prefix] = this.command;

    return new Promise((resolve, reject) => {
      execFile(
        bin,
        [...prefix, ...args],
        { env, timeout: timeoutMs, maxBuffer: MAX_OUTPUT, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error) reject(new KopiaError(`kopia ${args[0]} ${args[1] ?? ''} failed: ${tail(stderr)}`, stderr));
          else resolve(stdout);
        },
      );
    });
  }

  /** Connects, runs `fn` with a bound runner, always removes the session directory. */
  async session<T>(
    connection: KopiaConnection,
    fn: (run: (args: string[], timeoutMs?: number) => Promise<string>, env: NodeJS.ProcessEnv) => Promise<T>,
  ): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'lw-kopia-'));
    const env = this.env(
      dir,
      connection.password,
      connection.kind === 's3'
        ? { AWS_ACCESS_KEY_ID: connection.accessKeyId, AWS_SECRET_ACCESS_KEY: connection.secretAccessKey }
        : {},
    );

    try {
      await this.connect(connection, env);

      return await fn((args, timeoutMs) => this.run(args, env, timeoutMs), env);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async connect(connection: KopiaConnection, env: NodeJS.ProcessEnv): Promise<void> {
    if (connection.kind === 's3') {
      await this.run(
        [
          'repository',
          'connect',
          's3',
          `--bucket=${connection.bucket}`,
          `--prefix=${connection.prefix}`,
          `--endpoint=${connection.endpoint}`,
          '--disable-tls',
          '--region=garage',
          `--override-username=${KOPIA_CONTROL_USER.username}`,
          `--override-hostname=${KOPIA_CONTROL_USER.hostname}`,
        ],
        env,
        120_000,
      );

      return;
    }

    let last: unknown = null;

    for (const server of connection.servers) {
      try {
        await this.run(
          [
            'repository',
            'connect',
            'server',
            `--url=https://${hostPort(server.address, server.port)}`,
            `--server-cert-fingerprint=${connection.fingerprint}`,
            `--override-username=${connection.username}`,
            `--override-hostname=${connection.hostname}`,
          ],
          env,
          60_000,
        );

        return;
      } catch (error) {
        last = error;
      }
    }

    throw last instanceof Error ? last : new Error('no repository server reachable');
  }

  async listSnapshots(connection: KopiaConnection): Promise<KopiaSnapshot[]> {
    return await this.session(connection, async (run) =>
      JSON.parse(await run(['snapshot', 'list', '--all', '--json'])),
    );
  }

  async deleteSnapshots(connection: KopiaConnection, manifestIds: string[]): Promise<void> {
    if (!manifestIds.length) return;

    await this.session(connection, async (run) => {
      for (const id of manifestIds) await run(['snapshot', 'delete', id, '--delete']);
    });
  }

  async diff(connection: KopiaConnection, before: string, after: string): Promise<KopiaDiff> {
    return await this.session(connection, async (run) => parseKopiaDiff(await run(['diff', before, after])));
  }

  async list(connection: KopiaConnection, object: string): Promise<KopiaListEntry[]> {
    return await this.session(connection, async (run) => parseKopiaList(await run(['ls', '-l', object])));
  }

  /** Streams one file of a snapshot (`kopia show <root>/<path>`); the session ends when the stream does. */
  async show(connection: KopiaConnection, object: string): Promise<Readable> {
    const dir = await mkdtemp(join(tmpdir(), 'lw-kopia-'));
    const env = this.env(dir, connection.password);

    try {
      await this.connect(connection, env);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }

    const [bin, ...prefix] = this.command;
    const child = spawn(bin, [...prefix, 'show', object], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    const cleanup = () => void rm(dir, { recursive: true, force: true });

    child.on('close', cleanup);
    child.on('error', cleanup);

    return child.stdout;
  }

  /**
   * A whole snapshot (or one directory of it) written as a tar archive file (`kopia snapshot restore --mode=tar`):
   * the export side of a cross-cluster restore through the fleet service (3.24).
   */
  async restoreArchive(connection: KopiaConnection, object: string, file: string): Promise<void> {
    await this.session(connection, async (run) => {
      await run(['snapshot', 'restore', object, file, '--mode=tar'], 6 * 3_600_000);
    });
  }

  /**
   * Snapshots a local directory into the repository as the control plane's user (FULL): the import side of a
   * cross-cluster restore (3.24). Tags are `key:value` pairs (letters, digits, `-`).
   */
  async snapshotDirectory(
    connection: KopiaConnection,
    dir: string,
    description: string,
    tags: Record<string, string> = {},
  ): Promise<KopiaSnapshot> {
    return await this.session(connection, async (run) =>
      parseKopiaSnapshotCreate(
        await run(
          [
            'snapshot',
            'create',
            dir,
            `--description=${description.replace(/[^\w .:/-]/g, '').slice(0, 200)}`,
            ...Object.entries(tags)
              .filter(([k, v]) => /^[a-z0-9-]{1,32}$/i.test(k) && /^[a-z0-9.-]{1,128}$/i.test(v))
              .map(([k, v]) => `--tags=${k}:${v}`),
            '--json',
          ],
          6 * 3_600_000,
        ),
      ),
    );
  }

  /**
   * Re-asserts the expected policies (user decision 2026-10-27, before every retention run): drifted source policies
   * go back to `manual` only, a drifted global policy to the servers' setting. Returns what was found.
   */
  async reassertPolicies(connection: KopiaConnection): Promise<KopiaPolicyDrift> {
    return await this.session(connection, async (run, env) => {
      const drift = kopiaPolicyDrift(JSON.parse((await run(['policy', 'export'])) || '{}') as Record<string, unknown>);

      if (drift.sources.length) {
        const file = join(env['HOME'] as string, 'policies.json');

        await writeFile(
          file,
          JSON.stringify(Object.fromEntries(drift.sources.map((d) => [d.target, KOPIA_SOURCE_POLICY]))),
          { mode: 0o600 },
        );
        await run(['policy', 'import', `--from-file=${file}`]);
      }

      if (drift.global) await run(['policy', 'set', '--global', ...KOPIA_GLOBAL_POLICY_ARGS]);

      return drift;
    });
  }

  /** Adds (or updates) a Kopia user on the repository (control plane's FULL access to `type=user`). */
  async ensureUser(connection: KopiaConnection, user: string, password: string): Promise<void> {
    // Only the (scrypt) hash goes into the arguments, never the password.
    const hash = kopiaPasswordHash(password);

    await this.session(connection, async (run) => {
      try {
        await run(['server', 'user', 'add', user, `--user-password-hash=${hash}`]);
      } catch (error) {
        if (!(error instanceof KopiaError && /already exists/i.test(error.stderr))) throw error;

        await run(['server', 'user', 'set', user, `--user-password-hash=${hash}`]);
      }
    });
  }

  /** Makes running servers pick up user changes at once (`kopia server refresh`, control API). */
  async refreshServer(
    server: { address: string; port: number },
    fingerprint: string,
    controlPassword: string,
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'lw-kopia-'));

    try {
      await this.run(
        [
          'server',
          'refresh',
          `--address=https://${hostPort(server.address, server.port)}`,
          `--server-cert-fingerprint=${fingerprint}`,
        ],
        this.env(dir, '', { KOPIA_SERVER_PASSWORD: controlPassword }),
        60_000,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Secondary copy (3.20): blob-level `sync-to` from the repository (direct on the object store) to an external
   * target; never deletes at the destination. Object lock is the destination bucket's default retention.
   * `destination.env` carries the destination's credentials (e.g. `AWS_*`), `files` are written 0600 into the
   * session directory and their paths substituted for `{file:<name>}` in the arguments (SFTP key, known_hosts).
   */
  async syncTo(
    connection: Extract<KopiaConnection, { kind: 's3' }>,
    destination: { args: string[]; env?: Record<string, string>; files?: Record<string, string> },
  ): Promise<void> {
    await this.session(connection, async (_run, env) => {
      const dir = env['HOME'] as string;
      const paths: Record<string, string> = {};

      for (const [name, content] of Object.entries(destination.files ?? {})) {
        paths[name] = join(dir, `sync-${name.replace(/[^a-z0-9-]/gi, '')}`);
        await writeFile(paths[name], content, { mode: 0o600 });
      }

      const args = destination.args.map((a) => a.replace(/\{file:([a-z0-9-]+)\}/gi, (_m, n: string) => paths[n] ?? ''));

      await this.run(
        ['repository', 'sync-to', ...args, '--no-delete', '--parallel=4'],
        { ...env, ...(destination.env ?? {}) },
        6 * 3_600_000,
      );
    });
  }

  /**
   * Disaster recovery (3.20): connects to a repository on an external target (`source.args` after `repository
   * connect`, files substituted like `syncTo`) and copies its blobs into the object store, never deleting there.
   * The destination's keys go through the environment (the source must not need `AWS_*`, e.g. SFTP).
   */
  async syncFromExternal(
    source: { args: string[]; files?: Record<string, string> },
    password: string,
    destination: { endpoint: string; bucket: string; prefix: string; accessKeyId: string; secretAccessKey: string },
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'lw-kopia-'));
    const env = this.env(dir, password, {
      AWS_ACCESS_KEY_ID: destination.accessKeyId,
      AWS_SECRET_ACCESS_KEY: destination.secretAccessKey,
    });

    try {
      const paths: Record<string, string> = {};

      for (const [name, content] of Object.entries(source.files ?? {})) {
        paths[name] = join(dir, `source-${name.replace(/[^a-z0-9-]/gi, '')}`);
        await writeFile(paths[name], content, { mode: 0o600 });
      }

      const args = source.args.map((a) => a.replace(/\{file:([a-z0-9-]+)\}/gi, (_m, n: string) => paths[n] ?? ''));

      await this.run(
        [
          'repository',
          'connect',
          ...args,
          `--override-username=${KOPIA_CONTROL_USER.username}`,
          `--override-hostname=${KOPIA_CONTROL_USER.hostname}`,
        ],
        env,
        120_000,
      );
      await this.run(
        [
          'repository',
          'sync-to',
          's3',
          `--bucket=${destination.bucket}`,
          `--prefix=${destination.prefix}`,
          `--endpoint=${destination.endpoint}`,
          '--disable-tls',
          '--region=garage',
          '--no-delete',
          '--parallel=4',
        ],
        env,
        6 * 3_600_000,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
