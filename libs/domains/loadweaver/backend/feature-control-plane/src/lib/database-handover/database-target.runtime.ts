import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Client, type ClientConfig } from 'pg';

import { BUILTIN_MEMBER_DEFAULT_DIR } from '../utils/builtin-member.utils';
import {
  DATABASE_TARGET_FILENAME,
  databaseFenceInfo,
  isMutatingMethod,
  parseDatabaseTargetFile,
  writeBlockMessage,
  type DatabaseDeployment,
  type DatabaseFenceInfo,
  type DatabaseTargetFile,
} from './database-handover.utils';

/** Connection settings of the external database (the control plane's own Postgres, from its original environment). */
export interface ExternalDatabase {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: ClientConfig['ssl'];
}

/**
 * Process-wide state of the database handover (3.43), shared by the boot step (`main.ts`, before TypeORM connects),
 * the pg client the pool creates, the HTTP write guard and `DatabaseHandoverService`.
 */
export class DatabaseTargetRuntime {
  deployment: DatabaseDeployment = 'disabled';
  file: DatabaseTargetFile | null = null;
  external: ExternalDatabase | null = null;
  /** Writes paused by a running handover / return (the reason, shown in the 503). */
  freeze: string | null = null;
  /** On the members' target: no primary reachable, reads go to the external copy (read-only). */
  fallback = false;
  /** Since when the read-only fallback runs (null: not read-only). */
  fallbackSince: number | null = null;
  /** On the members' target: no primary answered the last polls, the fallback hasn't started yet (writes 503). */
  leaderMissing = false;
  /** The process started without reaching the members (startup steps that write failed: restart once they're back). */
  startedInFallback = false;
  /** On the members' target: since when no member primary answered the leader proxy (null: the last poll found one). */
  noPrimarySince: number | null = null;
  /** On a member (on-node): the fencing info of its database's handover row (refreshed by the handover service). */
  memberFence: DatabaseFenceInfo | null = null;
  private readonly clients = new Set<DatabaseTargetClient>();
  /** Background jobs currently paused by `writesPaused` (each logs entering / leaving once). */
  private readonly pausedJobs = new Set<string>();

  get target(): 'external' | 'members' | null {
    return this.deployment === 'external' ? (this.file?.target ?? 'external') : null;
  }

  /**
   * What members get as `controlPlane.databaseFence` (3.43 takeover): an external control plane's epoch / takeover /
   * scope from its target file, a member replica's from its database; null when unknown (disabled, not read yet).
   */
  databaseFence(): DatabaseFenceInfo | null {
    if (this.deployment === 'on-node') return this.memberFence;

    if (this.deployment !== 'external') return null;

    return databaseFenceInfo({
      epoch: this.file?.epoch,
      takenOverAt: this.file?.takenOverAt,
      scope: this.file?.postgresScope,
    });
  }

  /** Machine-readable reason of a write refusal (the 503 body's `code`): a handover freeze, or read-only. */
  writeBlockCode(): 'freeze' | 'read-only' | null {
    if (this.freeze) return 'freeze';

    return this.fallback || this.leaderMissing ? 'read-only' : null;
  }

  /**
   * Whether the cluster's database can't take writes right now: the read-only fallback, a handover / return freeze, or
   * no member primary on the members' target (the fallback hasn't started yet). Always false on-node / disabled.
   */
  writesBlocked(): boolean {
    return this.fallback || this.freeze !== null || this.leaderMissing;
  }

  /**
   * The one check every write-only background job runs at the start of its tick (3.43): true = skip this tick. Logs
   * once per job when it pauses and once when it resumes; skipped ticks in between only at debug level, so a read-only
   * control plane doesn't flood its log with "cannot execute … in a read-only transaction".
   */
  writesPaused(job: string, logger?: WritePauseLogger): boolean {
    const blocked = this.writesBlocked();
    const was = this.pausedJobs.has(job);

    if (blocked && !was) {
      this.pausedJobs.add(job);
      logger?.log(`${job}: paused while the cluster database can't take writes (${this.pauseReason()})`);
    } else if (!blocked && was) {
      this.pausedJobs.delete(job);
      logger?.log(`${job}: resumed, the cluster database takes writes again`);
    } else if (blocked) {
      logger?.debug?.(`${job}: skipped (${this.pauseReason()})`);
    }

    return blocked;
  }

  private pauseReason(): string {
    if (this.freeze) return `handover freeze: ${this.freeze}`;

    return this.fallback ? 'read-only fallback' : 'no member primary';
  }

  writeBlock(): string | null {
    return writeBlockMessage({ freeze: this.freeze, fallback: this.fallback, leaderMissing: this.leaderMissing });
  }

  track(client: DatabaseTargetClient): void {
    this.clients.add(client);
    client.once('end', () => this.clients.delete(client));
  }

  /**
   * Switches new pool connections between the members (through the in-process leader proxy) and the read-only external
   * copy; open connections to the other side are cut (the pool replaces them, LISTEN connections reconnect).
   */
  setFallback(fallback: boolean): void {
    if (this.fallback === fallback) return;

    this.fallback = fallback;
    this.fallbackSince = fallback ? Date.now() : null;

    for (const client of this.clients) {
      if (client.fallback !== fallback) client.cut();
    }
  }

  /** Tests. */
  reset(): void {
    this.deployment = 'disabled';
    this.file = null;
    this.external = null;
    this.freeze = null;
    this.fallback = false;
    this.fallbackSince = null;
    this.leaderMissing = false;
    this.startedInFallback = false;
    this.noPrimarySince = null;
    this.memberFence = null;
    this.clients.clear();
    this.pausedJobs.clear();
  }
}

/** What `writesPaused` logs through (a Nest `Logger`). */
export interface WritePauseLogger {
  log(message: string): void;
  debug?(message: string): void;
}

export const databaseTarget = new DatabaseTargetRuntime();

/**
 * Write-only background jobs call this first in every tick (3.43): true while the cluster's database can't take writes
 * (read-only fallback, handover freeze, no member primary); see `DatabaseTargetRuntime.writesPaused`.
 */
export function writesPaused(job: string, logger?: WritePauseLogger): boolean {
  return databaseTarget.writesPaused(job, logger);
}

const READ_ONLY_OPTION = '-c default_transaction_read_only=on';

/**
 * The pg client of the TypeORM pool (`extra.Client`): connects as configured, except during the read-only fallback,
 * when it connects to the external copy with read-only sessions (nothing can diverge from the members' data).
 */
export class DatabaseTargetClient extends Client {
  readonly fallback: boolean;

  constructor(config?: string | ClientConfig) {
    const external = databaseTarget.external;
    const fallback = databaseTarget.fallback && !!external;
    // pg-pool makes `password` non-enumerable (so it doesn't leak into logs): a spread drops it — every connection then
    // failed with "SCRAM … client password must be a string". Carry it over explicitly.
    const base: ClientConfig =
      typeof config === 'string'
        ? { connectionString: config }
        : { ...(config ?? {}), ...(config?.password !== undefined ? { password: config.password } : {}) };

    super(
      fallback && external
        ? {
            ...base,
            host: external.host,
            port: external.port,
            user: external.user,
            password: external.password,
            database: external.database,
            ssl: external.ssl,
            options: [base.options, READ_ONLY_OPTION].filter(Boolean).join(' '),
          }
        : base,
    );
    this.fallback = fallback;
    databaseTarget.track(this);
  }

  /** Drops the connection (the pool and its users see an error and reconnect). */
  cut(): void {
    (this as unknown as { connection?: { stream?: { destroy(error?: Error): void } } }).connection?.stream?.destroy(
      new Error('database target changed'),
    );
  }
}

export function databaseStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_BUILTIN_MEMBER_DIR']?.trim() || BUILTIN_MEMBER_DEFAULT_DIR;
}

export async function readDatabaseTargetFile(dir: string): Promise<DatabaseTargetFile | null> {
  return parseDatabaseTargetFile(await readFile(join(dir, DATABASE_TARGET_FILENAME), 'utf8').catch(() => null));
}

/** Atomic, 0600 in the state directory (0700). */
export async function writeDatabaseTargetFile(dir: string, file: DatabaseTargetFile): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, DATABASE_TARGET_FILENAME);
  const tmp = `${path}.${process.pid}.tmp`;

  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

interface GuardRequest {
  method?: string;
}

interface GuardResponse {
  status(code: number): GuardResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

/**
 * Write guard (3.43): while a handover / return runs, or during the read-only fallback, requests that write are
 * answered with 503 and a clear message; reads are served.
 */
export function databaseWriteGuard(
  runtime: Pick<DatabaseTargetRuntime, 'writeBlock'> &
    Partial<Pick<DatabaseTargetRuntime, 'writeBlockCode'>> = databaseTarget,
) {
  return (req: GuardRequest, res: GuardResponse, next: () => void): void => {
    const message = isMutatingMethod(req.method) ? runtime.writeBlock() : null;

    if (!message) {
      next();

      return;
    }

    res.setHeader('Retry-After', '30');
    res.status(503).json({
      statusCode: 503,
      error: 'Service Unavailable',
      // For clients (the fleet): `freeze` during a handover, `read-only` while the database can't take writes.
      code: runtime.writeBlockCode?.() ?? 'read-only',
      message,
    });
  };
}
