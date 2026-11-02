import { hkdfSync } from 'node:crypto';

/**
 * Control-plane database handover (3.43, user decision 2026-10-30 "members own it, external syncs"): pure decisions.
 *
 * A control plane started outside the cluster (the compose stack of the built-in setup, 3.39) starts on its own
 * Postgres ("external"). As soon as the first real member's Patroni leader is reachable, the control plane freezes
 * writes, copies its database into the members' cluster, and switches to it ("members"). The external database then
 * follows as a logical-replication subscriber ("external copy"): read-only fallback while every member is unreachable,
 * and the database again once no member is registered any more.
 */

/** Where this control-plane process runs relative to the cluster's database. */
export type DatabaseDeployment =
  /** On a member (the agent's API replica, or an on-node install): the members' database always was the database. */
  | 'on-node'
  /** Outside the cluster with its own Postgres (built-in setup): hands the database over to the members. */
  | 'external'
  /** `LOADWEAVER_DATABASE_HANDOVER=off`: an external control plane that keeps its own database (old behaviour). */
  | 'disabled';

/** Local port of the leader proxy of the agent (`LEADER_PROXY_PORT` in the node agent). */
export const AGENT_LEADER_PROXY_PORT = '5433';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * On-node vs external. On a member the agent sets `LOADWEAVER_CONTROL_PLANE_ON_MEMBER=true`; older agents don't, but
 * their API replica always reaches the database through the agent's leader proxy on loopback (`127.0.0.1:5433`), which
 * an external control plane never does. The built-in member mode is no signal: an operator may switch it off on the
 * compose stack and still want the handover.
 */
export function databaseDeployment(env: NodeJS.ProcessEnv): DatabaseDeployment {
  if (env['LOADWEAVER_CONTROL_PLANE_ON_MEMBER'] === 'true') return 'on-node';

  if (LOOPBACK.has((env['DB_HOST'] ?? '').trim()) && (env['DB_PORT'] ?? '').trim() === AGENT_LEADER_PROXY_PORT)
    return 'on-node';

  return (env['LOADWEAVER_DATABASE_HANDOVER'] ?? 'auto').trim().toLowerCase() === 'off' ? 'disabled' : 'external';
}

/** File on the control-plane state volume: which database this (external) control plane uses. */
export const DATABASE_TARGET_FILENAME = 'database-target.json';

/** Audit event the control plane records after the restart that completed a switch (the old database was frozen). */
export interface PendingDatabaseAudit {
  action: 'control-plane.database-handover' | 'control-plane.database-return' | 'control-plane.database-takeover';
  handoverId: string;
  at: string;
  details: Record<string, unknown>;
}

/**
 * What the control plane persists next to the built-in member's seal key (no credentials: the members' superuser is
 * `DB_USERNAME` / `DB_PASSWORD` of the replicated environment, i.e. the control plane's own).
 */
export interface DatabaseTargetFile {
  version: 1;
  target: 'external' | 'members';
  /** Overlay addresses of the real members' Postgres (refreshed while connected). */
  members: string[];
  /** The cluster CA the members' Postgres certificates chain to (public). */
  caCertificatePem: string | null;
  handoverId: string | null;
  updatedAt: string;
  pendingAudit?: PendingDatabaseAudit | null;
  /** Fencing epoch (3.43 takeover): +1 on every takeover and every handover; absent = 0. */
  epoch?: number;
  /**
   * When the built-in control plane last took the database over (null: never). Kept after a handover: members' fence
   * checks still need it; `activeTakeoverAt` tells whether the database is on the external side because of it.
   */
  takenOverAt?: string | null;
  /** The epoch that takeover started (3.43 live test: `takenOverAt` was shown after the database was handed back). */
  takeoverEpoch?: number | null;
  /** Patroni scope members start empty in since the last takeover (null: the cluster's scope). */
  postgresScope?: string | null;
}

export function parseDatabaseTargetFile(raw: string | null): DatabaseTargetFile | null {
  if (!raw) return null;

  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== 'object') return null;

  const v = value as Partial<DatabaseTargetFile>;

  if (v.version !== 1 || (v.target !== 'external' && v.target !== 'members')) return null;

  const members = Array.isArray(v.members) ? v.members.filter((m): m is string => typeof m === 'string' && !!m) : [];

  // A members target without anything to connect to is unusable: stay on the external database.
  if (v.target === 'members' && (members.length === 0 || typeof v.caCertificatePem !== 'string')) return null;

  return {
    version: 1,
    target: v.target,
    members,
    caCertificatePem: typeof v.caCertificatePem === 'string' ? v.caCertificatePem : null,
    handoverId: typeof v.handoverId === 'string' ? v.handoverId : null,
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : new Date(0).toISOString(),
    pendingAudit: v.pendingAudit && typeof v.pendingAudit === 'object' ? v.pendingAudit : null,
    epoch: typeof v.epoch === 'number' && Number.isInteger(v.epoch) && v.epoch >= 0 ? v.epoch : 0,
    takenOverAt: typeof v.takenOverAt === 'string' ? v.takenOverAt : null,
    takeoverEpoch:
      typeof v.takeoverEpoch === 'number' && Number.isInteger(v.takeoverEpoch) && v.takeoverEpoch >= 0
        ? v.takeoverEpoch
        : null,
    postgresScope: typeof v.postgresScope === 'string' && SCOPE.test(v.postgresScope) ? v.postgresScope : null,
  };
}

const SCOPE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** States of the `lw_database_handover` row (copied with the data, replicated to the external copy). */
export type HandoverRowState = 'external' | 'handover' | 'members';

export type HandoverAction =
  /** Nothing to do (no member yet, a member without a reachable leader, back-off after a failure). */
  | { kind: 'wait'; reason: string }
  /** Copy the external database to the members' leader and switch. */
  | { kind: 'handover' }
  /** Another replica handed over (the row says so): switch this process too. */
  | { kind: 'adopt' }
  /** No real member is registered any more (3.39 `r = 0`): the external copy becomes the database again. */
  | { kind: 'return' }
  /** On the members' database: keep the target file and the external copy in line. */
  | { kind: 'sync' }
  /** Every registered member is unreachable: serve read-only from the external copy, never promote. */
  | { kind: 'read-only' };

export interface HandoverDecisionInput {
  target: 'external' | 'members';
  /** The members' database is unreachable and the process reads from the external copy. */
  fallback: boolean;
  /** `r`: registered real control-plane members (not `left`) with a seal key (3.39). */
  realMembers: number;
  /** A Patroni primary among the real members answered. */
  leaderReachable: boolean;
  /** The handover row of the database the process uses now. */
  row: HandoverRowState | null;
  /** The last handover attempt failed less than the back-off ago. */
  backingOff: boolean;
}

export function handoverDecision(input: HandoverDecisionInput): HandoverAction {
  if (input.target === 'external') {
    if (input.realMembers === 0) return { kind: 'wait', reason: 'no real control-plane member is registered' };

    if (input.row === 'members') return { kind: 'adopt' };

    if (!input.leaderReachable) return { kind: 'wait', reason: "no member's Postgres leader is reachable yet" };

    if (input.backingOff) return { kind: 'wait', reason: 'the last handover failed; retrying later' };

    return { kind: 'handover' };
  }

  // Removed / left members (not an outage): the external copy takes over again, also while reading from it.
  if (input.realMembers === 0) return { kind: 'return' };

  return input.fallback ? { kind: 'read-only' } : { kind: 'sync' };
}

/** The 503 message while the members' database is unreachable (read-only fallback, or before it starts). */
export const MEMBERS_UNREACHABLE_MESSAGE =
  "the cluster's database members are unreachable; read-only until one is back";

/**
 * Message of the 503 for writes while the database can't take them; null: writes go through. `leaderMissing`: no
 * primary answered the last polls, but the fallback hasn't started yet (it waits `FALLBACK_AFTER_MS` for a Patroni
 * failover); writes would only fail with a 500 meanwhile (live 3.43: ~45 s).
 */
export function writeBlockMessage(state: {
  freeze: string | null;
  fallback: boolean;
  leaderMissing?: boolean;
}): string | null {
  if (state.freeze)
    return `the control plane is moving its database to the cluster's members (${state.freeze}); writes are paused for a moment, please retry`;

  if (state.fallback || state.leaderMissing) return MEMBERS_UNREACHABLE_MESSAGE;

  return null;
}

/** Postgres error classes 08 (connection exception), 57P01–57P03 (shutdown / not accepting connections), 25006. */
const UNAVAILABLE_SQLSTATE = /^(08...|57P0[123]|25006)$/;
const UNAVAILABLE_ERRNO = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH']);
const UNAVAILABLE_MESSAGE =
  /Connection terminated|connection timeout|timeout exceeded when trying to connect|database target changed|the database system is (shutting down|starting up|in recovery mode)|read-only transaction/i;

/**
 * Whether an error means the database can't be reached / can't write right now (a lost leader, a restart, a read-only
 * session in the fallback), as opposed to a failing query. The control plane on the members' database answers those
 * with a 503 instead of a 500 (3.43).
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === 'object' && depth < 4; depth++) {
    const { code, message, driverError } = e as { code?: unknown; message?: unknown; driverError?: unknown };

    if (typeof code === 'string' && (UNAVAILABLE_SQLSTATE.test(code) || UNAVAILABLE_ERRNO.has(code))) return true;

    if (typeof message === 'string' && UNAVAILABLE_MESSAGE.test(message)) return true;

    e = driverError;
  }

  return false;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Whether a request writes (and is refused while writes are blocked). */
export function isMutatingMethod(method: string | undefined): boolean {
  return !READ_METHODS.has((method ?? 'GET').toUpperCase());
}

/** The read-only fallback while the process is on the members' database (see `nextFallback`). */
export interface FallbackState {
  fallback: boolean;
  /** Since when no primary answered (null: the last poll found one). */
  missingSince: number | null;
  /** Polls in a row that found a primary (while in fallback). */
  seen: number;
}

/** No primary for this long: read-only from the external copy (a Patroni failover takes ≈ 30 s). */
export const FALLBACK_AFTER_MS = 45_000;
/** A primary answering this many polls in a row ends the fallback. */
export const FALLBACK_END_AFTER_POLLS = 3;

export function initialFallbackState(): FallbackState {
  return { fallback: false, missingSince: null, seen: 0 };
}

/**
 * Fallback transitions from one leader poll. `startup`: the process hasn't reached the members yet since it started,
 * so a missing primary means read-only right away (nothing to wait for).
 */
export function nextFallback(state: FallbackState, primaryFound: boolean, now: number, startup = false): FallbackState {
  if (primaryFound) {
    if (!state.fallback) return { fallback: false, missingSince: null, seen: 0 };

    const seen = state.seen + 1;

    return seen >= FALLBACK_END_AFTER_POLLS
      ? { fallback: false, missingSince: null, seen: 0 }
      : { fallback: true, missingSince: state.missingSince, seen };
  }

  const missingSince = state.missingSince ?? now;

  return {
    fallback: state.fallback || startup || now - missingSince >= FALLBACK_AFTER_MS,
    missingSince,
    seen: 0,
  };
}

/**
 * The control-plane role's `database` flag for members (feature `database-handover`): only an external control plane
 * sets it. `pending` keeps the members' API replicas stopped until their database exists.
 */
export function memberDatabaseFlag(
  deployment: DatabaseDeployment,
  target: 'external' | 'members' | null,
): 'pending' | 'ready' | undefined {
  if (deployment !== 'external') return undefined;

  return target === 'members' ? 'ready' : 'pending';
}

/** Tables the control plane copies and replicates (never the migration bookkeeping: each side runs its migrations). */
export const NOT_COPIED_TABLES = new Set(['migrations', 'typeorm_metadata']);

export interface TableInfo {
  name: string;
  /** Has a primary key (a replica identity for UPDATE / DELETE through logical replication). */
  primaryKey: boolean;
  /** A TimescaleDB hypertable: its rows live in chunks outside `public` (metrics, not replicated). */
  hypertable: boolean;
}

/**
 * Time series (metrics, flows and their roll-ups) stay out of the external copy: TimescaleDB turns them into hypertables
 * / continuous aggregates on the members, which logical replication can't carry; the read-only fallback doesn't need
 * them.
 */
export const NOT_REPLICATED_TABLE = /^lw_(metrics|flows)(_|$)/;

/** The publication's tables: with a primary key, no time series / hypertables, no migration bookkeeping; sorted. */
export function publishableTables(tables: readonly TableInfo[]): { published: string[]; skipped: string[] } {
  const published: string[] = [];
  const skipped: string[] = [];

  for (const t of [...tables].sort((a, b) => a.name.localeCompare(b.name))) {
    if (NOT_COPIED_TABLES.has(t.name)) continue;

    if (t.primaryKey && !t.hypertable && !NOT_REPLICATED_TABLE.test(t.name)) published.push(t.name);
    else skipped.push(t.name);
  }

  return { published, skipped };
}

/** Tables whose row count differs after the copy (`missing`: no count on the target). */
export function rowCountMismatches(
  source: Readonly<Record<string, number>>,
  target: Readonly<Record<string, number>>,
): string[] {
  return Object.keys(source)
    .sort()
    .filter((table) => target[table] !== source[table])
    .map((table) => `${table}: ${source[table]} → ${target[table] ?? 'missing'}`);
}

/**
 * Schema differences that would lose data in the copy: the target's schema comes from the same migrations, so a table
 * or column only the source has means the source drifted (the copy is refused).
 */
export function schemaMismatches(
  source: Readonly<Record<string, readonly string[]>>,
  target: Readonly<Record<string, readonly string[]>>,
): string[] {
  const problems: string[] = [];

  for (const table of Object.keys(source).sort()) {
    const columns = target[table];

    if (!columns) {
      problems.push(`table ${table} is missing on the members' database`);
      continue;
    }

    const missing = source[table].filter((c) => !columns.includes(c));

    if (missing.length) problems.push(`${table}: columns ${missing.join(', ')} are missing on the members' database`);
  }

  return problems;
}

/** Postgres identifier quoting. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Postgres string literal quoting (standard_conforming_strings). */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function conninfoValue(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * The subscription's connection to the members (used by the external Postgres server itself): every member, the
 * primary picked by libpq (`target_session_attrs=read-write`), so a Patroni failover only needs the slot. TLS without
 * verification: the external server has no copy of the cluster CA (documented).
 */
export function subscriptionConninfo(input: {
  members: readonly string[];
  port: number;
  database: string;
  user: string;
  password: string;
}): string {
  return [
    `host=${conninfoValue(input.members.join(','))}`,
    `port=${conninfoValue(input.members.map(() => String(input.port)).join(','))}`,
    `dbname=${conninfoValue(input.database)}`,
    `user=${conninfoValue(input.user)}`,
    `password=${conninfoValue(input.password)}`,
    'sslmode=require',
    'target_session_attrs=read-write',
    'connect_timeout=10',
    'application_name=lw_external_copy',
  ].join(' ');
}

export const EXTERNAL_COPY_PUBLICATION = 'lw_external_copy';
export const EXTERNAL_COPY_SUBSCRIPTION = 'lw_external_copy';

/** What the external copy needs next (checked on every sync while the members' database is reachable). */
export type ExternalCopyAction =
  | { kind: 'ok' }
  /**
   * No subscription (the handover's attempt failed, or a crash between the re-copy's steps): copied from the members
   * (`recopy`) and subscribed.
   */
  | { kind: 'create' }
  /** New migrations on the members: migrate the external copy, then refresh the subscription's tables. */
  | { kind: 'migrate' }
  /** The publication's table list changed (new tables): `REFRESH PUBLICATION`. */
  | { kind: 'refresh' }
  /** The subscription is disabled (an interrupted migrate step) with every table in sync: enable it again. */
  | { kind: 'enable' }
  /** New tables are still being copied by the subscription (after a refresh): not complete yet, nothing to do. */
  | { kind: 'syncing' }
  /**
   * Broken beyond a refresh (slot lost, a new primary without a copy of the slot, persistent apply errors, tables stuck
   * copying): copied again into the existing tables in one transaction (`recopy`), so the previous complete copy stays
   * readable and usable for a takeover until the new one commits.
   */
  | { kind: 'resync'; reason: string };

export interface ExternalCopyStatus {
  subscription: boolean;
  /** The subscription's slot exists on the current primary. */
  slotOnPrimary: boolean;
  /** Migrations executed on the members' database but not on the external copy. */
  pendingMigrations: number;
  /** Published tables the subscription doesn't have yet. */
  unsubscribedTables: number;
  /** The apply worker has kept failing since this long (ms; 0: fine). */
  failingForMs: number;
  /** The subscription is enabled (default true). */
  enabled?: boolean;
  /** Subscribed tables not in state `r` on the external database. */
  tablesNotReady?: number;
  /** Tables have been not ready since this long (ms; 0: all ready). */
  syncingForMs?: number;
  /** The members' primary now (overlay address). */
  leader?: string | null;
  /** The primary at the previous check (from the last report; null / undefined: unknown). */
  previousLeader?: string | null;
  /**
   * Members that held the slot at the previous check (the primary's original and the replicas' Patroni copies; null /
   * undefined: unknown, e.g. a report from before 3.43's failover slots).
   */
  previousSlotHolders?: readonly string[] | null;
}

/** Apply errors (or tables copying) for this long mean a conflict a refresh can't fix: copy again. */
export const RESYNC_AFTER_FAILING_MS = 10 * 60_000;

export function externalCopyAction(status: ExternalCopyStatus): ExternalCopyAction {
  if (status.pendingMigrations > 0) return { kind: 'migrate' };

  if (!status.subscription) return { kind: 'create' };

  if (!status.slotOnPrimary)
    return { kind: 'resync', reason: "the subscription's slot is missing on the primary (lost in a failover)" };

  // Patroni keeps the slot on replicas (permanent logical slot): after a failover the new primary continues from its
  // copy. A new primary that held no copy got the slot created afresh by Patroni: changes in between would be missing.
  if (
    status.leader &&
    status.previousLeader &&
    status.leader !== status.previousLeader &&
    status.previousSlotHolders &&
    !status.previousSlotHolders.includes(status.leader)
  )
    return {
      kind: 'resync',
      reason: `the new primary ${status.leader} held no copy of the slot before the failover (changes in between would be missing)`,
    };

  const notReady = status.tablesNotReady ?? 0;

  if (status.enabled === false)
    return notReady > 0
      ? { kind: 'resync', reason: 'the subscription was left disabled while tables were still being copied' }
      : { kind: 'enable' };

  if (status.failingForMs >= RESYNC_AFTER_FAILING_MS)
    return { kind: 'resync', reason: 'the subscription keeps failing to apply changes' };

  if (notReady > 0 && (status.syncingForMs ?? 0) >= RESYNC_AFTER_FAILING_MS)
    return { kind: 'resync', reason: `${notReady} table(s) have been copying for more than 10 minutes` };

  if (status.unsubscribedTables > 0) return { kind: 'refresh' };

  if (notReady > 0) return { kind: 'syncing' };

  return { kind: 'ok' };
}

/** Names of the external copy's slots (`lw_external_copy_<12 hex>`, one per subscription). */
export const EXTERNAL_COPY_SLOT_PREFIX = 'lw_external_copy_';

/**
 * The Patroni dynamic-configuration patch (`PATCH /config`) that makes the external copy's slot a **permanent logical
 * slot** (3.43, user decision 2026-10-31 "failover slots + keep copy"): Patroni creates it on the primary if missing,
 * copies it to every replica and advances it there, so a failover keeps the subscription's position and no re-copy is
 * needed. Slots of earlier subscriptions are removed (`null`), `hot_standby_feedback` is on (needed for logical slots on
 * replicas; Patroni would enable it too). `slot = null` only removes. Null: the configuration is already right.
 */
export function permanentSlotPatch(
  config: unknown,
  slot: string | null,
  database: string,
): Record<string, unknown> | null {
  const current = (config && typeof config === 'object' ? config : {}) as {
    slots?: Record<string, { type?: unknown; database?: unknown; plugin?: unknown } | null> | null;
    postgresql?: { parameters?: Record<string, unknown> | null } | null;
  };
  const slots = current.slots ?? {};
  const patch: Record<string, unknown> = {};
  const slotPatch: Record<string, unknown> = {};

  for (const name of Object.keys(slots))
    if (name.startsWith(EXTERNAL_COPY_SLOT_PREFIX) && name !== slot) slotPatch[name] = null;

  if (slot) {
    const existing = slots[slot];

    if (!existing || existing.type !== 'logical' || existing.database !== database || existing.plugin !== 'pgoutput')
      slotPatch[slot] = { type: 'logical', database, plugin: 'pgoutput' };

    const feedback = current.postgresql?.parameters?.['hot_standby_feedback'];

    if (!(feedback === true || ['on', 'true', 'yes', '1'].includes(String(feedback ?? '').toLowerCase())))
      patch['postgresql'] = { parameters: { hot_standby_feedback: 'on' } };
  }

  if (Object.keys(slotPatch).length) patch['slots'] = slotPatch;

  return Object.keys(patch).length ? patch : null;
}

/**
 * Since when the external copy is known complete (every table `r`, the members' sync said ok): the newest of the
 * previous `completeAt` and this report's time when it is `ok`. Carried through `syncing` / `error` reports, so a
 * refresh or a re-copy doesn't erase it (the takeover's staleness check uses it).
 */
export function copyCompleteAt(
  previous: string | null | undefined,
  report: { state: string; checkedAt: string },
): string | null {
  if (report.state === 'ok') return report.checkedAt;

  return previous ?? null;
}

/** Migration names executed on the members' database that the external copy hasn't run. */
export function pendingMigrationNames(members: readonly string[], external: readonly string[]): string[] {
  const done = new Set(external);

  return members.filter((m) => !done.has(m));
}

/** Back-off after a failed handover attempt (doubling, at most 10 min). */
export function handoverBackoffMs(failures: number): number {
  return Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, failures - 1));
}

/** The members' Spilo roles with their own password (`PGPASSWORD_STANDBY` / `PGPASSWORD_ADMIN` in the node agent). */
export const POSTGRES_ROLE_PASSWORD_ENV = {
  replication: 'LOADWEAVER_POSTGRES_REPLICATION_PASSWORD',
  admin: 'LOADWEAVER_POSTGRES_ADMIN_PASSWORD',
} as const;

/**
 * The members' replication / admin role passwords, derived (HKDF) from the cluster's encryption key like the
 * object-store secrets (user decision 2026-10-30): a control plane outside the nodes (3.43) without
 * `LOADWEAVER_POSTGRES_REPLICATION_PASSWORD` / `_ADMIN_PASSWORD` gave the roles no password, so replicas never streamed.
 * Only used at push time (`memberEnvironment`), never persisted or logged.
 */
export function postgresRolePasswords(encryptionKey: string): { replication: string; admin: string } {
  const key = Buffer.from(encryptionKey, 'utf8');
  const derive = (label: string) =>
    Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), `loadweaver/postgres/${label}`, 24)).toString('hex');

  return { replication: derive('replication'), admin: derive('admin') };
}

/** Explicit values win; an unset (or empty) one is derived from `ENCRYPTION_KEY` when there is one. */
export function withPostgresRolePasswords(
  environment: Record<string, string>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const key = env['ENCRYPTION_KEY'];

  if (!key) return environment;

  const derived = postgresRolePasswords(key);
  const next = { ...environment };

  for (const purpose of ['replication', 'admin'] as const) {
    const name = POSTGRES_ROLE_PASSWORD_ENV[purpose];

    if (!next[name]) next[name] = derived[purpose];
  }

  return next;
}

// ------------------------------------------------------------------------------------------------ takeover (3.43)
//
// User decision 2026-10-31 (supersedes "read-only, never a takeover"): after ~2 min without any member primary, the
// built-in control plane promotes its external copy (if that is usable) and writes again. Every takeover and every
// handover increments a fencing epoch; member data of an older epoch never acts as primary again: the members' agents
// move it aside (rows written after the takeover exported, never merged), start empty, and a new handover re-seeds them.

/** Default wait without any member primary before the takeover (`LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS`). */
export const DEFAULT_TAKEOVER_AFTER_MS = 120_000;

/**
 * The takeover delay from `LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS`; null = off (`0`, `off`, `false`, `no`: the old
 * read-only behaviour). Never shorter than the fallback (a Patroni failover must have had its chance).
 */
export function takeoverAfterMs(env: NodeJS.ProcessEnv): number | null {
  const raw = (env['LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS'] ?? '').trim().toLowerCase();

  if (!raw) return DEFAULT_TAKEOVER_AFTER_MS;

  if (['0', 'off', 'false', 'no', 'disabled'].includes(raw)) return null;

  const ms = Number(raw);

  if (!Number.isFinite(ms) || ms < 0) return DEFAULT_TAKEOVER_AFTER_MS;

  return Math.max(FALLBACK_AFTER_MS, Math.round(ms));
}

export type TakeoverTiming =
  /** Not applicable: not on the members' target, or a primary answers. */
  | { kind: 'none' }
  /** Takeover is switched off: read-only until a member is back. */
  | { kind: 'off' }
  /** No primary yet for long enough. */
  | { kind: 'wait'; remainingMs: number }
  /** Long enough without a primary: check the external copy and take over if it is usable. */
  | { kind: 'due' };

export function takeoverTiming(input: {
  target: 'external' | 'members' | null;
  fallback: boolean;
  /** Since when no member primary answered the leader proxy (null: the last poll found one). */
  noPrimarySince: number | null;
  now: number;
  afterMs: number | null;
}): TakeoverTiming {
  if (input.target !== 'members' || !input.fallback || input.noPrimarySince === null) return { kind: 'none' };

  if (input.afterMs === null) return { kind: 'off' };

  const elapsed = input.now - input.noPrimarySince;

  return elapsed >= input.afterMs ? { kind: 'due' } : { kind: 'wait', remainingMs: input.afterMs - elapsed };
}

/** The external copy was confirmed in sync at most this long before the members went away (`…_MAX_LAG_MS`). */
export const DEFAULT_TAKEOVER_MAX_LAG_MS = 5 * 60_000;

export function takeoverMaxLagMs(env: NodeJS.ProcessEnv): number {
  const ms = Number((env['LOADWEAVER_DATABASE_TAKEOVER_MAX_LAG_MS'] ?? '').trim() || DEFAULT_TAKEOVER_MAX_LAG_MS);

  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_TAKEOVER_MAX_LAG_MS;
}

/** What the external database says about itself as a copy (read over a dedicated session, see `copyReadiness`). */
export interface ExternalCopyReadiness {
  /** The subscription `lw_external_copy` exists on the external database. */
  subscription: boolean;
  /** Subscribed tables not in state `r` (still copying / syncing: the copy would be partial). */
  tablesNotReady: number;
  /** The external database's handover row (replicated from the members). */
  rowState: HandoverRowState | null;
  /**
   * The `external_copy` report of the members' sync, as replicated to the external database: its arrival through the
   * subscription proves the copy applied changes up to `checkedAt`.
   */
  copyState: string | null;
  copyCheckedAt: string | null;
  /**
   * The report's "complete as of" (`completeAt`): the last time the members found every table in sync and said ok;
   * carried through later `syncing` / `error` reports. Older reports don't have it (then `ok` + `copyCheckedAt`).
   */
  copyCompleteAt?: string | null;
  /** The replicated row's epoch (the members' last handover). */
  rowEpoch?: number | null;
}

/**
 * Whether the external copy may become the database (null) or why not. Usable = the subscription exists (enabled, or
 * disabled while a re-copy builds the next one) with every table synchronized, the row says the members own the data,
 * and the copy was last confirmed complete (`completeAt`, replicated through the subscription itself) no more than
 * `maxLagMs` before the members went away. A re-copy never touches the previous copy before it commits, so this checks
 * the last complete copy, not the one in progress.
 */
export function externalCopyUnusable(
  readiness: ExternalCopyReadiness,
  noPrimarySince: number,
  maxLagMs: number,
): string | null {
  if (!readiness.subscription)
    return 'the external copy has no subscription (it was never set up, or is being re-created)';

  if (readiness.tablesNotReady > 0)
    return `the external copy is incomplete: ${readiness.tablesNotReady} table(s) were still being copied`;

  if (readiness.rowState !== 'members')
    return `the external copy's handover row says ${readiness.rowState ?? 'nothing'}, not members`;

  const complete = readiness.copyCompleteAt ?? (readiness.copyState === 'ok' ? readiness.copyCheckedAt : null);

  if (!complete) return `the members' last report on the external copy was ${readiness.copyState ?? 'missing'}, not ok`;

  const checked = Date.parse(complete);

  if (!Number.isFinite(checked)) return "the members' last report on the external copy has no valid time";

  const lag = noPrimarySince - checked;

  if (lag > maxLagMs)
    return `the external copy was last confirmed in sync ${Math.round(lag / 1000)} s before the members went away (more than ${Math.round(maxLagMs / 1000)} s)`;

  return null;
}

/** The Patroni scope members start empty in after the takeover of `epoch` (the old scope belongs to fenced data). */
export function takeoverPostgresScope(clusterScope: string, epoch: number): string {
  const suffix = `-t${epoch}`;

  return `${clusterScope.slice(0, 63 - suffix.length).replace(/-+$/, '')}${suffix}`;
}

/**
 * The takeover the database is on the external side because of (3.43 live test: `takenOverAt` stayed in the status and
 * the fleet after a handover moved the database back to the members): only while the target is external and no
 * handover (epoch + 1) happened since. Files written before `takeoverEpoch` existed: the epoch in the takeover's
 * scope (`<cluster>-t<epoch>`).
 */
export function activeTakeoverAt(
  file: Pick<DatabaseTargetFile, 'target' | 'epoch' | 'takenOverAt' | 'takeoverEpoch' | 'postgresScope'> | null,
): string | null {
  if (!file || file.target !== 'external' || !file.takenOverAt) return null;

  const scopeEpoch = /-t(\d+)$/.exec(file.postgresScope ?? '')?.[1];
  const takeoverEpoch = file.takeoverEpoch ?? (scopeEpoch !== undefined ? Number(scopeEpoch) : null);

  return takeoverEpoch === (file.epoch ?? 0) ? file.takenOverAt : null;
}

/** What the control plane found in a member primary's `DB_DATABASE` (`memberDataState`). */
export interface MemberDataState {
  /** The database exists. */
  database: boolean;
  /** Its handover row's state (null: no row / no table). */
  state: string | null;
  /** Its handover row's epoch (0 for rows before the epoch column). */
  epoch: number | null;
}

/**
 * A member primary's data belongs to an older epoch (written before the last takeover): never switched to, never
 * dropped (its rows after the takeover are exported by the member's agent), fenced instead.
 */
export function memberDataFenced(data: MemberDataState, epoch: number): boolean {
  return data.database && data.epoch !== null && data.epoch < epoch;
}

/** The fencing info members get in `controlPlane.databaseFence` (feature `database-fencing`). */
export interface DatabaseFenceInfo {
  epoch: number;
  takenOverAt?: string;
  scope?: string;
}

export function databaseFenceInfo(input: {
  epoch: number | null | undefined;
  takenOverAt: string | null | undefined;
  scope: string | null | undefined;
}): DatabaseFenceInfo {
  const takenOverAt = input.takenOverAt ? new Date(input.takenOverAt) : null;

  return {
    epoch: Math.max(0, Math.trunc(input.epoch ?? 0)),
    ...(takenOverAt && Number.isFinite(takenOverAt.getTime()) ? { takenOverAt: takenOverAt.toISOString() } : {}),
    ...(input.scope && SCOPE.test(input.scope) ? { scope: input.scope } : {}),
  };
}

/** A fenced member's report (heartbeat `databaseFence`) as the control plane keeps it. */
export interface DatabaseFenceRecord {
  node: string;
  epoch: number;
  dataEpoch: number;
  at: string;
  dataDir: string;
  exportDir?: string;
  exportBytes?: number;
  exportRows?: number;
  exportError?: string;
}

/** Fence reports kept in the handover row (newest last). */
export const MAX_FENCE_RECORDS = 20;

/** Adds a report unless it is known (same node and time); null: nothing new. */
export function withFenceRecord(
  records: readonly DatabaseFenceRecord[],
  record: DatabaseFenceRecord,
): DatabaseFenceRecord[] | null {
  if (records.some((r) => r.node === record.node && r.at === record.at)) return null;

  return [...records, record].slice(-MAX_FENCE_RECORDS);
}

export function parseFenceRecords(value: unknown): DatabaseFenceRecord[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (r): r is DatabaseFenceRecord =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as DatabaseFenceRecord).node === 'string' &&
      typeof (r as DatabaseFenceRecord).at === 'string' &&
      typeof (r as DatabaseFenceRecord).dataDir === 'string',
  );
}

/** Human-readable byte size for messages (`12.3 MB`). */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }

  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
