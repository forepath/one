import { randomUUID } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';

import { POSTGRES_TLS_SERVER_NAME } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Client, type ClientConfig } from 'pg';
import { DataSource, Not } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

import { NodeEntity } from '../entities/node.entity';
import { AuditLogService } from '../services/audit-log.service';
import { ClusterIdentityService } from '../services/cluster-identity.service';
import { copyDatabase, type CopyResult } from './database-copy';
import { connectExternal, guardClientErrors, type SqlClient } from './database-target.boot';
import {
  activeTakeoverAt,
  copyCompleteAt,
  databaseFenceInfo,
  externalCopyAction,
  externalCopyUnusable,
  handoverBackoffMs,
  handoverDecision,
  memberDataFenced,
  MEMBERS_UNREACHABLE_MESSAGE,
  parseFenceRecords,
  permanentSlotPatch,
  quoteIdent,
  subscriptionConninfo,
  takeoverAfterMs,
  takeoverMaxLagMs,
  takeoverPostgresScope,
  takeoverTiming,
  type DatabaseFenceRecord,
  type DatabaseTargetFile,
  type HandoverRowState,
  type MemberDataState,
} from './database-handover.utils';
import type { DatabaseInboxInput } from './database-inbox';
import { advanceSequences, copyReadiness, fenceMemberDatabase, memberDataState } from './database-takeover';
import {
  databaseStateDir,
  databaseTarget,
  writeDatabaseTargetFile,
  type DatabaseTargetRuntime,
  type ExternalDatabase,
} from './database-target.runtime';
import {
  createSlotWithSnapshot,
  createSubscription,
  disableSubscription,
  dropSlot,
  dropSubscription,
  enableSubscription,
  ensurePublication,
  externalCopyStatus,
  holdsSlot,
  refreshSubscription,
  walLevel,
} from './external-copy';
import {
  findMembersPrimaries,
  findMembersPrimary,
  MEMBER_PATRONI_PORT,
  MEMBER_POSTGRES_PORT,
  membersProxy,
} from './members-leader-proxy';

const TICK_MS = Number(process.env['LOADWEAVER_DATABASE_HANDOVER_INTERVAL_MS'] ?? 15_000);
/** Serializes handovers of several external replicas (session lock on the external database). */
const ADVISORY_LOCK_HANDOVER = 4_300_043;
/** How long the handover waits for `wal_level = logical` after asking Patroni for it (members restart Postgres). */
const WAL_LEVEL_WAIT_MS = 3 * 60_000;

export interface ExternalCopyReport {
  state: 'off' | 'ok' | 'syncing' | 'error';
  error: string | null;
  checkedAt: string;
  /** Tables not replicated (no primary key / hypertables). */
  skipped?: string[];
  /**
   * "Complete as of" (3.43): the last check that found every table in sync and said ok, carried through later
   * `syncing` / `error` reports (a refresh or re-copy keeps the previous complete copy). The takeover's staleness check
   * reads it from the external database (it arrives through the subscription itself).
   */
  completeAt?: string | null;
  /** The members' primary at the last full check, and the subscription's slot. */
  leader?: string | null;
  slot?: string | null;
  /** Members holding the slot at the last full check (the primary, plus replicas with Patroni's copy). */
  slotHolders?: string[];
  /** The slot is registered as a Patroni permanent logical slot (kept on the replicas across a failover). */
  failoverSlot?: boolean;
}

/** The automatic fenced takeover by the built-in control plane (3.43, 2026-10-31). */
export interface DatabaseTakeoverStatus {
  /** `LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS` (null: off, read-only until a member is back). */
  afterMs: number | null;
  /**
   * `idle`: a member primary answers (or not on the members' target); `waiting`: no primary yet for `afterMs`;
   * `blocked`: due, but the built-in can't write (`reason`); `off`; `taken-over`: running on the database it took over.
   */
  state: 'idle' | 'waiting' | 'blocked' | 'off' | 'taken-over';
  reason: string | null;
  /** Since when no member primary answered (members' target only). */
  noPrimarySince: string | null;
}

export interface DatabaseHandoverStatus {
  deployment: 'on-node' | 'external' | 'disabled';
  /** Where the cluster's database lives for this control plane. */
  location: 'external' | 'members' | null;
  readOnly: boolean;
  freeze: string | null;
  handoverId: string | null;
  lastError: string | null;
  externalCopy: ExternalCopyReport | null;
  /**
   * Why the control plane can't write while read-only (members unreachable, copy not usable, takeover off, external
   * database unreachable, waiting for the takeover); null when it can write.
   */
  readOnlyReason: string | null;
  /** When the read-only fallback started (null: not read-only). */
  readOnlySince: string | null;
  /** Fencing epoch: +1 on every takeover and handover; member data of an older epoch never acts as primary. */
  epoch: number;
  /** When the built-in control plane last took the database over (null: never). */
  takenOverAt: string | null;
  /** Patroni scope members start empty in since the last takeover (null: the cluster's scope). */
  postgresScope: string | null;
  takeover: DatabaseTakeoverStatus;
  /** What fenced members reported (moved-aside data, exported rows), newest last. */
  fences: DatabaseFenceRecord[];
}

/** Side effects of the handover (replaced by fakes in specs). */
export interface HandoverDeps {
  findPrimary(addresses: readonly string[]): Promise<string | null>;
  /** Every member primary (several after a takeover, while returning members with old data aren't fenced yet). */
  findPrimaries(addresses: readonly string[]): Promise<string[]>;
  connectExternal(): Promise<SqlClient & { end(): Promise<void> }>;
  /** `replication`: a logical replication connection (`replication=database`), for the re-copy's slot + snapshot. */
  connectMembers(
    address: string,
    database: string,
    options?: { replication?: boolean },
  ): Promise<SqlClient & { end(): Promise<void> }>;
  /** Runs the control plane's migrations against a database (the members' new one, or the external copy). */
  migrate(target: { address: string } | 'external'): Promise<void>;
  patroni(address: string, method: 'PATCH' | 'POST', path: string, body: unknown): Promise<number>;
  /** Patroni REST `GET` (JSON), e.g. `/config` for the permanent-slot check. */
  patroniGet(address: string, path: string): Promise<unknown>;
  writeFile(file: DatabaseTargetFile): Promise<void>;
  /** A controlled restart (the container's restart policy brings the process back on the new target). */
  restart(reason: string): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

const ROW_UPSERT = `INSERT INTO "lw_database_handover" ("id", "state", "handover_id", "epoch", "updated_at")
  VALUES ('cluster', $1, $2, $3, now())
  ON CONFLICT ("id") DO UPDATE SET "state" = EXCLUDED."state", "handover_id" = EXCLUDED."handover_id",
    "epoch" = EXCLUDED."epoch", "updated_at" = now()`;

/** The takeover's mark on the external database (3.43): the database again, a new epoch, the scope for fresh members. */
const TAKEOVER_ROW = `INSERT INTO "lw_database_handover" ("id", "state", "epoch", "taken_over_at", "postgres_scope", "updated_at")
  VALUES ('cluster', 'external', $1, $2, $3, now())
  ON CONFLICT ("id") DO UPDATE SET "state" = 'external', "epoch" = EXCLUDED."epoch",
    "taken_over_at" = EXCLUDED."taken_over_at", "postgres_scope" = EXCLUDED."postgres_scope", "updated_at" = now()`;

const MEMBER_FENCE_REFRESH_MS = 30_000;

/**
 * Control-plane database handover (3.43, decided 2026-10-30 "members own it, external syncs"), external control plane
 * only (`databaseDeployment` = `external`):
 *
 * - **handover**: once a real member's Patroni leader is reachable — writes frozen (HTTP 503 + database-level
 *   read-only on the external database), database `DB_DATABASE` created on the members (owner `DB_USERNAME`, the
 *   members' superuser from the replicated environment), schema from the same migrations, data copied in one snapshot,
 *   row counts verified, publication + subscription set up, target file written, controlled restart onto the members;
 *   audited `control-plane.database-handover` after the restart (on the members' database);
 * - **sync**: keeps the target file's member addresses / CA current and the external copy healthy (migrations on the
 *   external copy, refresh; the slot is a Patroni permanent logical slot, so a failover keeps it; a re-copy only when
 *   it is really lost, built in one transaction so the previous complete copy stays usable until it commits);
 * - **read-only**: every member unreachable → the in-process proxy switched the pool to the external copy;
 * - **takeover** (user decision 2026-10-31): no member primary for `LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS` (2 min) and
 *   the external copy usable → subscription dropped (the members' slot stays: they are unreachable), sequences moved
 *   past the replicated rows, row `external` with a new fencing epoch and the Patroni scope fresh members start in,
 *   target file, controlled restart; audited `control-plane.database-takeover`. Member primaries whose data belongs to
 *   an older epoch are fenced (database-level, their agents move the data aside) and never switched to; the next
 *   handover re-seeds the members;
 * - **return**: no real member registered (`r = 0`, 3.39) → subscription dropped, the external copy becomes the
 *   database again (restart), audited `control-plane.database-return`.
 */
@Injectable()
export class DatabaseHandoverService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseHandoverService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private failures = 0;
  private retryAt = 0;
  private lastError: string | null = null;
  private lastWait: string | null = null;
  private copyFailingSince: number | null = null;
  private copySyncingSince: number | null = null;
  /** The last Patroni permanent-slot error (logged once per distinct message). */
  private failoverSlotWarning: string | null = null;
  private externalCopy: ExternalCopyReport | null = null;
  private restarting = false;
  private takeover: Omit<DatabaseTakeoverStatus, 'afterMs' | 'noPrimarySince'> = { state: 'idle', reason: null };
  private fences: DatabaseFenceRecord[] = [];
  /** The epoch of the handover row of the database this process uses (read each step). */
  private rowEpoch = 0;
  /** Member primaries fenced at the database level (address@epoch), logged once. */
  private readonly fenced = new Set<string>();

  /**
   * The cluster CA, read before the freeze: the freeze terminates the external database's other sessions, so a read
   * through the pool right after it hit a terminated connection and failed every handover (live 3.43).
   */
  private frozenCa: string | null = null;

  /** Replaceable in tests. */
  runtime: DatabaseTargetRuntime = databaseTarget;
  env: NodeJS.ProcessEnv = process.env;
  deps: HandoverDeps;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly identity: ClusterIdentityService,
    private readonly audit: AuditLogService,
  ) {
    this.deps = this.defaultDeps();
  }

  onApplicationBootstrap(): void {
    // A member replica tells its agents the epoch of the data it runs on (`controlPlane.databaseFence`).
    if (this.runtime.deployment === 'on-node') {
      this.timer = setInterval(() => void this.refreshMemberFence(), MEMBER_FENCE_REFRESH_MS);
      this.timer.unref?.();
      setTimeout(() => void this.refreshMemberFence(), 1_000).unref?.();

      return;
    }

    if (this.runtime.deployment !== 'external') return;

    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 5_000).unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);

    this.timer = null;
    membersProxy.current?.stop();
  }

  status(): DatabaseHandoverStatus {
    const file = this.runtime.file;
    const external = this.runtime.deployment === 'external';
    const noPrimarySince = this.runtime.noPrimarySince;

    return {
      deployment: this.runtime.deployment,
      location: this.runtime.target,
      readOnly: this.runtime.fallback,
      freeze: this.runtime.freeze,
      handoverId: file?.handoverId ?? null,
      lastError: this.lastError,
      externalCopy: this.externalCopy,
      readOnlyReason: this.runtime.fallback
        ? this.takeover.state !== 'idle' && this.takeover.reason
          ? this.takeover.reason
          : MEMBERS_UNREACHABLE_MESSAGE
        : null,
      readOnlySince:
        this.runtime.fallback && this.runtime.fallbackSince !== null
          ? new Date(this.runtime.fallbackSince).toISOString()
          : null,
      epoch: external ? (file?.epoch ?? 0) : (this.runtime.memberFence?.epoch ?? 0),
      // Only while the database is on the external side because of a takeover (3.43 live test: it stayed after the
      // handover back to the members, and the fleet kept showing it). The fence info keeps it (agents need it).
      takenOverAt: external ? activeTakeoverAt(file) : null,
      postgresScope: external ? (file?.postgresScope ?? null) : (this.runtime.memberFence?.scope ?? null),
      takeover: {
        afterMs: takeoverAfterMs(this.env),
        ...(external && activeTakeoverAt(file) ? { state: 'taken-over' as const, reason: null } : this.takeover),
        noPrimarySince:
          this.runtime.target === 'members' && noPrimarySince !== null ? new Date(noPrimarySince).toISOString() : null,
      },
      fences: this.fences,
    };
  }

  /** What the overview's inbox needs (kind `database`); fences read from the database this process uses. */
  async inboxState(): Promise<DatabaseInboxInput> {
    const status = this.status();
    const rows = (await this.dataSource
      .query(`SELECT to_jsonb(h)->'fences' AS fences FROM "lw_database_handover" h WHERE h."id" = 'cluster'`)
      .catch(() => [])) as { fences: unknown }[];

    return {
      location: status.location,
      readOnly: status.readOnly,
      takenOverAt: status.location === 'external' ? status.takenOverAt : null,
      takeoverBlocked:
        status.readOnly && (status.takeover.state === 'blocked' || status.takeover.state === 'off')
          ? status.takeover.reason
          : null,
      fences: rows.length ? parseFenceRecords(rows[0].fences) : this.fences,
    };
  }

  /** On a member replica: the epoch / takeover / scope of the data it runs on, for its agents. */
  async refreshMemberFence(): Promise<void> {
    const rows = (await this.dataSource
      .query(
        `SELECT to_jsonb(h)->>'epoch' AS epoch, to_jsonb(h)->>'taken_over_at' AS taken_over_at,
                to_jsonb(h)->>'postgres_scope' AS postgres_scope
           FROM "lw_database_handover" h WHERE h."id" = 'cluster'`,
      )
      .catch(() => null)) as
      | { epoch: string | null; taken_over_at: string | null; postgres_scope: string | null }[]
      | null;

    if (!rows) return;

    this.runtime.memberFence = databaseFenceInfo({
      epoch: rows[0]?.epoch ? Number(rows[0].epoch) : 0,
      takenOverAt: rows[0]?.taken_over_at ?? null,
      scope: rows[0]?.postgres_scope ?? null,
    });
  }

  /** One reconcile step (serialized). */
  async tick(): Promise<void> {
    if (this.running || this.restarting) return await this.running?.catch(() => undefined);

    this.running = this.step()
      .catch((error: unknown) => {
        this.lastError = message(error);
        this.logger.warn(`Database handover step failed: ${this.lastError}`);
      })
      .finally(() => (this.running = null));

    await this.running;
  }

  private async step(): Promise<void> {
    const target = this.runtime.target ?? 'external';

    if (!this.runtime.fallback)
      await this.recordPendingAudit().catch((error: unknown) =>
        this.logger.warn(`Database handover audit event not recorded yet: ${message(error)}`),
      );

    const members = await this.realMembers();
    const addresses = members.map((m) => m.address).filter((a): a is string => !!a);
    const primaries = target === 'external' && addresses.length ? await this.deps.findPrimaries(addresses) : [];
    const action = handoverDecision({
      target,
      fallback: this.runtime.fallback,
      realMembers: members.length,
      leaderReachable: primaries.length > 0,
      row: await this.rowState(),
      backingOff: this.deps.now() < this.retryAt,
    });

    if (action.kind !== 'wait') this.lastWait = null;

    if (action.kind !== 'read-only') this.takeover = { state: 'idle', reason: null };

    switch (action.kind) {
      case 'wait':
        if (action.reason !== this.lastWait) this.logger.log(`Database handover: waiting (${action.reason})`);

        this.lastWait = action.reason;

        return;
      case 'handover': {
        const leader = await this.handoverLeader(primaries);

        if (!leader) return;

        return await this.handover(leader, addresses);
      }
      case 'adopt':
        return await this.adopt(addresses, this.rowEpoch);
      case 'return':
        return await this.returnToExternal();
      case 'read-only':
        return await this.readOnly();
      case 'sync':
        await this.sync(addresses);
        // Healthy on the members again: an error of an earlier step (e.g. during an outage) is history (live 3.43).
        this.lastError = null;

        return;
    }
  }

  /** `r` (3.39): real control-plane members, not `left`, with a seal key; with their overlay address. */
  private async realMembers(): Promise<{ name: string; address: string | null }[]> {
    const nodes = await this.dataSource
      .getRepository(NodeEntity)
      .find({ where: { controlPlane: true, lifecycle: Not('left') }, order: { name: 'ASC' } });

    return nodes
      .filter((n) => !!n.sealPublicKey)
      .map((n) => ({ name: n.name, address: n.overlayV4 ?? n.overlayV6 ?? null }));
  }

  private async rowState(): Promise<HandoverRowState | null> {
    const rows = (await this.dataSource
      .query(
        `SELECT "state", to_jsonb(h)->'fences' AS fences, to_jsonb(h)->>'epoch' AS epoch
           FROM "lw_database_handover" h WHERE "id" = 'cluster'`,
      )
      .catch(() => [])) as { state: HandoverRowState; fences?: unknown; epoch?: string | null }[];

    if (rows[0]) this.fences = parseFenceRecords(rows[0].fences);

    this.rowEpoch = rows[0]?.epoch ? Number(rows[0].epoch) : 0;

    return rows[0]?.state ?? null;
  }

  /** The fencing epoch this control plane knows (its target file). */
  private epoch(): number {
    return this.runtime.file?.epoch ?? 0;
  }

  private wait(reason: string): void {
    if (reason !== this.lastWait) this.logger.log(`Database handover: waiting (${reason})`);

    this.lastWait = reason;
  }

  /** The epoch etc. of a member primary's `DB_DATABASE`; null when it can't be read. */
  private async memberData(address: string): Promise<MemberDataState | null> {
    const database = this.env['DB_DATABASE'] || 'loadweaver';
    const admin = await this.deps.connectMembers(address, 'postgres').catch(() => null);

    if (!admin) return null;

    try {
      return await memberDataState(admin, database, async () => await this.deps.connectMembers(address, database));
    } catch {
      return null;
    } finally {
      await admin.end().catch(() => undefined);
    }
  }

  /**
   * Fences a member primary whose data belongs to an older epoch at the database level (read-only, sessions cut, the
   * fence settings its agent reads): it never becomes the database, nothing of it is dropped (3.43 takeover).
   */
  private async fenceMember(address: string): Promise<void> {
    const epoch = this.epoch();
    const file = this.runtime.file;
    const admin = await this.deps.connectMembers(address, 'postgres');

    try {
      await fenceMemberDatabase(admin, this.env['DB_DATABASE'] || 'loadweaver', {
        epoch,
        takenOverAt: file?.takenOverAt ?? file?.updatedAt ?? new Date(this.deps.now()).toISOString(),
        scope: file?.postgresScope ?? null,
      });
    } finally {
      await admin.end().catch(() => undefined);
    }

    const key = `${address}@${epoch}`;

    if (!this.fenced.has(key)) {
      this.fenced.add(key);
      this.logger.warn(
        `Member primary ${address} holds data of an older epoch than ${epoch}: fenced (read-only); its agent moves the data aside`,
      );
    }
  }

  /**
   * The one member primary a handover may use (3.43 takeover): primaries whose data belongs to an older epoch are
   * fenced and skipped; with more than one primary answering (a returning member still leads its old scope) the
   * handover waits until the fenced ones stepped down, so neither the copy nor the subscription can land on them.
   */
  private async handoverLeader(primaries: readonly string[]): Promise<string | null> {
    const epoch = this.epoch();
    const candidates: string[] = [];

    for (const primary of primaries) {
      const data = await this.memberData(primary);

      if (!data) continue;

      if (memberDataFenced(data, epoch)) {
        await this.fenceMember(primary).catch((error: unknown) =>
          this.logger.warn(`Fencing member primary ${primary} failed (retried): ${message(error)}`),
        );
        continue;
      }

      candidates.push(primary);
    }

    if (candidates.length === 1 && primaries.length === 1) return candidates[0];

    this.wait(
      candidates.length === 0
        ? `no member primary with current data (epoch ${epoch}): ${primaries.join(', ')} fenced or unreadable; their agents start them empty`
        : `several member primaries answer (${primaries.join(', ')}): waiting until the fenced ones step down`,
    );

    return null;
  }

  /** On the members' database: a second primary with data of an older epoch (a returning member) is fenced. */
  private async fenceStalePrimaries(addresses: string[]): Promise<void> {
    const primaries = await this.deps.findPrimaries(addresses);

    if (primaries.length < 2) return;

    const leader = membersProxy.current?.currentLeader() ?? null;

    for (const primary of primaries.filter((p) => p !== leader)) {
      const data = await this.memberData(primary);

      if (data && memberDataFenced(data, this.epoch()))
        await this.fenceMember(primary).catch((error: unknown) =>
          this.logger.warn(`Fencing member primary ${primary} failed (retried): ${message(error)}`),
        );
    }
  }

  /**
   * Read-only fallback (3.43): after `LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS` without any member primary, the built-in
   * control plane takes over when its external copy is usable; otherwise it stays read-only and says why.
   */
  private async readOnly(): Promise<void> {
    const timing = takeoverTiming({
      target: this.runtime.target,
      fallback: this.runtime.fallback,
      noPrimarySince: this.runtime.noPrimarySince,
      now: this.deps.now(),
      afterMs: takeoverAfterMs(this.env),
    });

    switch (timing.kind) {
      case 'none':
        this.takeover = { state: 'idle', reason: null };

        return;
      case 'off':
        this.takeover = {
          state: 'off',
          reason:
            'the automatic takeover is off (LOADWEAVER_DATABASE_TAKEOVER_AFTER_MS); read-only until a member is back',
        };

        return;
      case 'wait':
        this.takeover = {
          state: 'waiting',
          reason: `no member's Postgres is primary; the built-in control plane takes over in ${Math.ceil(timing.remainingMs / 1000)} s if its copy is usable`,
        };

        return;
      case 'due':
        return await this.takeOver();
    }
  }

  private blocked(reason: string): void {
    if (this.takeover.state !== 'blocked' || this.takeover.reason !== reason)
      this.logger.warn(`Database takeover not possible, staying read-only: ${reason}`);

    this.takeover = { state: 'blocked', reason };
  }

  /**
   * The fenced takeover (3.43, user decision 2026-10-31): the external copy becomes the database with a new epoch.
   * The subscription goes without touching the members (their slot stays, they are unreachable), the copy gets the
   * migrations and sequences past the replicated rows, the row and target file say `external` (epoch, time, the scope
   * fresh members start in), then a controlled restart onto it. Audited after the restart.
   */
  private async takeOver(): Promise<void> {
    const noPrimarySince = this.runtime.noPrimarySince ?? this.deps.now();
    let external: SqlClient & { end(): Promise<void> };

    try {
      external = await this.deps.connectExternal();
    } catch (error) {
      this.blocked(`the external database is unreachable: ${message(error)}`);

      return;
    }

    try {
      const [{ locked }] = (
        await external.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_HANDOVER])
      ).rows;

      if (!locked) return;

      await external.query('SET default_transaction_read_only = off');

      const readiness = await copyReadiness(external);
      const unusable = externalCopyUnusable(readiness, noPrimarySince, takeoverMaxLagMs(this.env));

      if (unusable) {
        this.blocked(unusable);

        return;
      }

      // A primary came back meanwhile: no takeover (the proxy ends the fallback).
      if (this.runtime.file?.members.length && (await this.deps.findPrimary(this.runtime.file.members))) return;

      const file = this.runtime.file;
      const previousEpoch = Math.max(this.epoch(), readiness.rowEpoch ?? 0);
      const epoch = previousEpoch + 1;
      const takenOverAt = new Date(this.deps.now()).toISOString();
      const scope = takeoverPostgresScope((await this.identity.cluster()).clusterId, epoch);

      this.logger.warn(
        `Database takeover: no member's Postgres was primary since ${new Date(noPrimarySince).toISOString()}; the built-in control plane promotes its external copy (epoch ${epoch})`,
      );

      const slot = await dropSubscription(external);

      await this.deps.migrate('external');

      const sequences = await advanceSequences(external);

      await external.query(TAKEOVER_ROW, [epoch, takenOverAt, scope]);
      await this.saveFile(
        this.file({
          target: 'external',
          members: [],
          caCertificatePem: null,
          epoch,
          takenOverAt,
          takeoverEpoch: epoch,
          postgresScope: scope,
          pendingAudit: {
            action: 'control-plane.database-takeover',
            handoverId: file?.handoverId ?? 'none',
            at: takenOverAt,
            details: {
              epoch,
              previousEpoch,
              members: file?.members ?? [],
              noPrimarySince: new Date(noPrimarySince).toISOString(),
              copyCheckedAt: readiness.copyCheckedAt,
              // Kept on the members (unreachable); they are fenced and re-seeded anyway.
              slot,
              sequences,
              postgresScope: scope,
            },
          },
        }),
      );
      this.takeover = { state: 'taken-over', reason: null };
      this.lastError = null;
      this.restart(`the built-in control plane took over the cluster's database (epoch ${epoch})`);
    } catch (error) {
      this.blocked(`the takeover failed: ${message(error)}`);
    } finally {
      await external.end().catch(() => undefined);
    }
  }

  private file(patch: Partial<DatabaseTargetFile>): DatabaseTargetFile {
    return {
      version: 1,
      target: 'external',
      members: [],
      caCertificatePem: null,
      handoverId: null,
      pendingAudit: null,
      ...this.runtime.file,
      ...patch,
      updatedAt: new Date(this.deps.now()).toISOString(),
    };
  }

  private async saveFile(file: DatabaseTargetFile): Promise<void> {
    await this.deps.writeFile(file);
    this.runtime.file = file;
  }

  private restart(reason: string): void {
    this.restarting = true;
    this.logger.warn(`Restarting the control plane: ${reason}`);
    this.deps.restart(reason);
  }

  private async handover(leader: string, addresses: string[]): Promise<void> {
    const database = this.env['DB_DATABASE'] || 'loadweaver';
    const owner = this.env['DB_USERNAME'] || 'postgres';
    const handoverId = randomUUID();
    const external = await this.deps.connectExternal();

    try {
      const [{ locked }] = (
        await external.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_HANDOVER])
      ).rows;

      if (!locked) return;

      await external.query('SET default_transaction_read_only = off');

      // Before the freeze: the members' database can be prepared while the control plane still takes writes.
      const adopted = await this.prepareMembers(leader, addresses, database, owner).catch((error: unknown) => {
        this.backOff(error);
        throw error;
      });

      if (adopted) return;

      this.frozenCa = await this.identity.caCertificate();
      this.logger.log(
        `Database handover ${handoverId}: copying the external database to the members (leader ${leader})`,
      );
      this.runtime.freeze = 'handover';

      let result: CopyResult;
      // Every handover starts a new fencing epoch (3.43): data the members held before is older.
      const epoch = this.epoch() + 1;

      try {
        await external.query(ROW_UPSERT, ['handover', handoverId, this.epoch()]);
        await external.query(`ALTER DATABASE ${quoteIdent(database)} SET default_transaction_read_only = on`);
        // Every other session (the pool, LISTEN connections) reconnects into the read-only setting.
        await external.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
             AND backend_type = 'client backend'`,
        );
        await this.deps.migrate({ address: leader });
        const members = await this.deps.connectMembers(leader, database);

        try {
          result = await copyDatabase(external, members);
          await members.query(ROW_UPSERT, ['members', handoverId, epoch]);
          await external.query(ROW_UPSERT, ['members', handoverId, epoch]);
          this.externalCopy = await this.startExternalCopy(members, external, addresses, leader);
          await members
            .query(`UPDATE "lw_database_handover" SET "external_copy" = $1::jsonb WHERE "id" = 'cluster'`, [
              JSON.stringify(this.externalCopy),
            ])
            .catch(() => undefined);
        } finally {
          await members.end().catch(() => undefined);
        }
      } catch (error) {
        await this.abortHandover(external, leader, database, error);

        return;
      }

      await this.saveFile(
        this.file({
          target: 'members',
          members: addresses,
          caCertificatePem: await this.caCertificate(),
          handoverId,
          epoch,
          pendingAudit: {
            action: 'control-plane.database-handover',
            handoverId,
            at: new Date(this.deps.now()).toISOString(),
            details: {
              epoch,
              leader,
              members: addresses,
              tables: result.tables,
              rows: result.rows,
              sequences: result.sequences,
              externalCopy: this.externalCopy.state,
            },
          },
        }),
      );
      this.failures = 0;
      this.lastError = null;
      this.logger.log(
        `Database handover ${handoverId}: ${result.rows} rows in ${result.tables} tables copied and verified; switching to the members`,
      );
      this.restart('the cluster database moved to the members');
    } finally {
      this.frozenCa = null;
      await external.end().catch(() => undefined);
    }
  }

  /**
   * Creates the members' database (dropping one a failed attempt left behind) and switches the members to
   * `wal_level = logical` for the external copy. True: the members already own the database (another replica handed
   * over): adopted instead.
   */
  private async prepareMembers(leader: string, addresses: string[], database: string, owner: string): Promise<boolean> {
    const admin = await this.deps.connectMembers(leader, 'postgres');

    try {
      const [{ recovery }] = (await admin.query<{ recovery: boolean }>('SELECT pg_is_in_recovery() AS recovery')).rows;

      if (recovery) throw new Error(`the members' leader ${leader} is still in recovery`);

      const { rows } = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [database]);

      if (rows.length) {
        const existing = await this.deps.connectMembers(leader, database);
        const state = await existing
          .query<{ state: string }>(`SELECT "state" FROM "lw_database_handover" WHERE "id" = 'cluster'`)
          .then((r) => r.rows[0]?.state ?? null)
          .catch(() => null)
          .finally(() => void existing.end().catch(() => undefined));

        if (state === 'members') {
          await this.adopt(addresses, (await this.memberData(leader))?.epoch ?? this.epoch());

          return true;
        }

        await admin.query(`DROP DATABASE ${quoteIdent(database)} WITH (FORCE)`);
      }

      await admin.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(owner)}`);

      if (this.copyEnabled()) await this.ensureLogicalWal(admin, leader, addresses, database);
    } finally {
      await admin.end().catch(() => undefined);
    }

    return false;
  }

  /**
   * Logical decoding needs `wal_level = logical` (a Postgres restart): set through Patroni's dynamic configuration,
   * with `ignore_slots` so Patroni leaves the subscription's slots alone, then a restart of the members with a pending
   * restart. Before the freeze, while the members' database is still unused. A failure leaves the external copy off
   * (reported), never the handover.
   */
  private async ensureLogicalWal(
    admin: SqlClient,
    leader: string,
    addresses: string[],
    database: string,
  ): Promise<void> {
    try {
      if ((await walLevel(admin)) === 'logical') return;

      const status = await this.deps.patroni(leader, 'PATCH', '/config', {
        postgresql: { parameters: { wal_level: 'logical' } },
        ignore_slots: [{ type: 'logical', plugin: 'pgoutput', database }],
      });

      if (status >= 300) throw new Error(`Patroni refused the configuration change (HTTP ${status})`);

      const deadline = this.deps.now() + WAL_LEVEL_WAIT_MS;

      while (this.deps.now() < deadline) {
        await this.deps.sleep(5_000);

        for (const address of addresses)
          await this.deps.patroni(address, 'POST', '/restart', { restart_pending: true }).catch(() => 0);

        const probe = await this.deps.connectMembers(leader, 'postgres').catch(() => null);

        if (!probe) continue;

        try {
          if ((await walLevel(probe)) === 'logical') return;
        } finally {
          await probe.end().catch(() => undefined);
        }
      }

      throw new Error('wal_level did not become logical in time');
    } catch (error) {
      this.logger.warn(`External copy: logical replication not prepared on the members: ${message(error)}`);
    }
  }

  private async caCertificate(): Promise<string> {
    return this.frozenCa ?? (await this.identity.caCertificate());
  }

  private backOff(error: unknown): void {
    this.failures++;
    this.retryAt = this.deps.now() + handoverBackoffMs(this.failures);
    this.lastError = message(error);
  }

  private async abortHandover(external: SqlClient, leader: string, database: string, error: unknown): Promise<void> {
    this.backOff(error);
    this.logger.error(`Database handover failed, the external database stays the database: ${this.lastError}`);
    try {
      await external.query(`ALTER DATABASE ${quoteIdent(database)} RESET default_transaction_read_only`);
      await external.query(ROW_UPSERT, ['external', null, this.epoch()]).catch(() => undefined);
    } catch (resetError) {
      // The next start lifts it (`prepareDatabaseTarget`); until then background writes fail.
      this.logger.error(`External database still read-only after the failed handover: ${message(resetError)}`);
    } finally {
      this.runtime.freeze = null;
    }

    const admin = await this.deps.connectMembers(leader, 'postgres').catch(() => null);

    if (admin)
      await admin
        .query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`)
        .catch(() => undefined)
        .finally(() => void admin.end().catch(() => undefined));
  }

  /** Another replica handed over: this process follows (target file + restart). */
  private async adopt(addresses: string[], epoch: number): Promise<void> {
    if (!addresses.length) return;

    await this.saveFile(
      this.file({
        target: 'members',
        members: addresses,
        caCertificatePem: await this.identity.caCertificate(),
        epoch: Math.max(this.epoch(), epoch),
      }),
    );
    this.restart('the cluster database is on the members (handed over by another replica)');
  }

  /** `r = 0`: the subscription goes, the external copy is the database again. */
  private async returnToExternal(): Promise<void> {
    const handoverId = this.runtime.file?.handoverId ?? null;

    this.runtime.freeze = 'returning to the external database';

    try {
      const external = await this.deps.connectExternal();
      let slot: string | null = null;

      try {
        await external.query('SET default_transaction_read_only = off');
        slot = await dropSubscription(external);
        // The row's epoch column (the copy may be behind the members' migrations after an outage).
        await this.deps.migrate('external').catch(() => undefined);
        await external.query(ROW_UPSERT, ['external', handoverId, this.epoch()]);
      } finally {
        await external.end().catch(() => undefined);
      }

      // Best effort: the members may be gone already.
      const leader =
        slot && this.runtime.file?.members.length ? await this.deps.findPrimary(this.runtime.file.members) : null;

      if (slot && leader) {
        await this.ensureFailoverSlot(leader, null);

        const members = await this.deps
          .connectMembers(leader, this.env['DB_DATABASE'] || 'loadweaver')
          .catch(() => null);

        if (members)
          await dropSlot(members, slot)
            .catch(() => undefined)
            .finally(() => void members.end().catch(() => undefined));
      }

      await this.saveFile(
        this.file({
          target: 'external',
          members: [],
          caCertificatePem: null,
          pendingAudit: {
            action: 'control-plane.database-return',
            handoverId: handoverId ?? 'none',
            at: new Date(this.deps.now()).toISOString(),
            details: { reason: 'no real control-plane member is registered any more' },
          },
        }),
      );
      this.restart('no real control-plane member is registered: the external copy is the database again');
    } catch (error) {
      this.runtime.freeze = null;
      throw error;
    }
  }

  private async sync(addresses: string[]): Promise<void> {
    const file = this.runtime.file;

    // Started while no member was reachable: startup steps that write failed, so start again on the members.
    if (this.runtime.startedInFallback) {
      this.restart("the members' database is reachable again");

      return;
    }

    if (file && addresses.length && addresses.join(',') !== file.members.join(',')) {
      const ca = await this.identity.caCertificate();

      await this.saveFile(this.file({ members: addresses, caCertificatePem: ca }));
      membersProxy.current?.setMembers(addresses);
    }

    // A member that came back with data of an older epoch leads its old scope next to the members' leader.
    await this.fenceStalePrimaries(addresses).catch((error: unknown) =>
      this.logger.warn(`Checking for stale member primaries failed: ${message(error)}`),
    );

    if (!this.copyEnabled()) {
      this.externalCopy = { state: 'off', error: null, checkedAt: new Date(this.deps.now()).toISOString() };

      return;
    }

    this.externalCopy = await this.syncExternalCopy(addresses, this.externalCopy ?? (await this.storedExternalCopy()));
    await this.dataSource
      .query(`UPDATE "lw_database_handover" SET "external_copy" = $1::jsonb WHERE "id" = 'cluster'`, [
        JSON.stringify(this.externalCopy),
      ])
      .catch(() => undefined);
  }

  private copyEnabled(): boolean {
    return (this.env['LOADWEAVER_DATABASE_EXTERNAL_COPY'] ?? 'on').trim().toLowerCase() !== 'off';
  }

  private conninfo(addresses: string[]): string {
    return subscriptionConninfo({
      members: addresses,
      port: MEMBER_POSTGRES_PORT,
      database: this.env['DB_DATABASE'] || 'loadweaver',
      user: this.env['DB_USERNAME'] || 'postgres',
      password: this.env['DB_PASSWORD'] ?? '',
    });
  }

  private slotName(): string {
    return `lw_external_copy_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  /** Right after the copy (still frozen): both sides hold the same data, so no initial copy. */
  private async startExternalCopy(
    members: SqlClient,
    external: SqlClient,
    addresses: string[],
    leader: string,
  ): Promise<ExternalCopyReport> {
    const checkedAt = new Date(this.deps.now()).toISOString();

    if (!this.copyEnabled()) return { state: 'off', error: null, checkedAt };

    try {
      const { published, skipped } = await ensurePublication(members);
      const slot = this.slotName();

      await dropSubscription(external);
      await createSubscription(external, this.conninfo(addresses), {
        copyData: false,
        slot,
        tables: published,
      });

      const failoverSlot = await this.ensureFailoverSlot(leader, slot);

      return {
        state: 'ok',
        error: null,
        checkedAt,
        skipped,
        completeAt: checkedAt,
        leader,
        slot,
        slotHolders: [leader],
        failoverSlot,
      };
    } catch (error) {
      this.logger.warn(`External copy not set up yet (retried while on the members): ${message(error)}`);

      return { state: 'error', error: message(error), checkedAt };
    }
  }

  /** The members' last report (after a restart: the decision needs the previous primary and slot holders). */
  private async storedExternalCopy(): Promise<ExternalCopyReport | null> {
    const rows = (await this.dataSource
      .query(`SELECT "external_copy" AS report FROM "lw_database_handover" WHERE "id" = 'cluster'`)
      .catch(() => [])) as { report: ExternalCopyReport | null }[];

    return rows[0]?.report && typeof rows[0].report === 'object' ? rows[0].report : null;
  }

  /**
   * The external copy while on the members' database: migrations, refresh, enable, re-copy; the slot registered as a
   * Patroni permanent logical slot, and which members hold it (3.43, user decision 2026-10-31 "failover slots + keep
   * copy"). The previous primary / holders and "complete as of" carry over from `previous` unless this check replaced
   * them: a decision that needs a re-copy is repeated until the re-copy succeeded.
   */
  private async syncExternalCopy(
    addresses: string[],
    previous: ExternalCopyReport | null,
  ): Promise<ExternalCopyReport> {
    const now = this.deps.now();
    const checkedAt = new Date(now).toISOString();
    const carried: Partial<ExternalCopyReport> = {
      completeAt: previous?.completeAt ?? (previous?.state === 'ok' ? previous.checkedAt : null),
      leader: previous?.leader ?? null,
      slot: previous?.slot ?? null,
      ...(previous?.slotHolders ? { slotHolders: previous.slotHolders } : {}),
      ...(previous?.failoverSlot !== undefined ? { failoverSlot: previous.failoverSlot } : {}),
    };
    const report = (
      state: ExternalCopyReport['state'],
      error: string | null,
      extra: Partial<ExternalCopyReport> = {},
    ): ExternalCopyReport => ({
      ...carried,
      state,
      error,
      checkedAt,
      ...extra,
      completeAt: copyCompleteAt(carried.completeAt, { state, checkedAt }),
    });
    const leader = await this.deps.findPrimary(addresses);

    if (!leader) return report('error', "no member's Postgres leader reachable");

    const database = this.env['DB_DATABASE'] || 'loadweaver';
    let members: (SqlClient & { end(): Promise<void> }) | null = null;
    let external: (SqlClient & { end(): Promise<void> }) | null = null;

    try {
      members = await this.deps.connectMembers(leader, database);
      external = await this.deps.connectExternal();
      await external.query('SET default_transaction_read_only = off');

      if ((await walLevel(members)) !== 'logical') return report('error', "the members' wal_level is not logical");

      const { skipped } = await ensurePublication(members);
      const status = await externalCopyStatus(members, external);

      this.copyFailingSince = status.failing ? (this.copyFailingSince ?? now) : null;
      this.copySyncingSince = (status.tablesNotReady ?? 0) > 0 ? (this.copySyncingSince ?? now) : null;

      const slotHolders = status.slot
        ? await this.slotHolders(addresses, leader, status.slot, status.slotOnPrimary)
        : [];
      const action = externalCopyAction({
        ...status,
        failingForMs: this.copyFailingSince === null ? 0 : now - this.copyFailingSince,
        syncingForMs: this.copySyncingSince === null ? 0 : now - this.copySyncingSince,
        leader,
        previousLeader: previous?.leader ?? null,
        previousSlotHolders: previous?.slotHolders ?? null,
      });
      // What this check saw; not recorded while a re-copy is due, so the decision repeats until one succeeded.
      const observed = async (): Promise<Partial<ExternalCopyReport>> => ({
        skipped,
        leader,
        slot: status.slot,
        slotHolders,
        failoverSlot: status.slot && status.slotOnPrimary ? await this.ensureFailoverSlot(leader, status.slot) : false,
      });

      switch (action.kind) {
        case 'ok':
          return report('ok', null, await observed());
        case 'syncing':
          return report('syncing', null, await observed());
        case 'enable':
          await enableSubscription(external);

          return report('syncing', null, await observed());
        case 'migrate':
          // The same migrations on the external copy, then the subscription picks up new tables.
          if (status.subscription) await disableSubscription(external);

          await this.deps.migrate('external');

          if (status.subscription) {
            await enableSubscription(external);
            await refreshSubscription(external);
          }

          this.copyFailingSince = null;

          return report('syncing', null, { skipped });
        case 'refresh':
          await refreshSubscription(external);

          return report('syncing', null, await observed());
        case 'create':
        case 'resync': {
          if (action.kind === 'resync') this.logger.warn(`External copy: copying again (${action.reason})`);

          const slot = await this.recopy(leader, members, external, status, addresses);

          this.copyFailingSince = null;
          this.copySyncingSince = null;

          return report('syncing', null, {
            skipped,
            leader,
            slot,
            slotHolders: [leader],
            failoverSlot: await this.ensureFailoverSlot(leader, slot),
          });
        }
      }
    } catch (error) {
      return report('error', message(error));
    } finally {
      await members?.end().catch(() => undefined);
      await external?.end().catch(() => undefined);
    }
  }

  /** Members holding the slot: the primary (if it has it) and every replica with Patroni's copy (best effort). */
  private async slotHolders(
    addresses: readonly string[],
    leader: string,
    slot: string,
    onPrimary: boolean,
  ): Promise<string[]> {
    const database = this.env['DB_DATABASE'] || 'loadweaver';
    const holders = onPrimary ? [leader] : [];

    for (const address of addresses) {
      if (address === leader) continue;

      const client = await this.deps.connectMembers(address, database).catch(() => null);

      if (!client) continue;

      try {
        if (await holdsSlot(client, slot)) holders.push(address);
      } catch {
        // An unreachable / restarting replica just doesn't count as a holder.
      } finally {
        await client.end().catch(() => undefined);
      }
    }

    return holders.sort();
  }

  /**
   * A full re-copy that keeps the previous copy usable (3.43, user decision 2026-10-31): the old subscription is only
   * disabled; a new slot is created over a replication connection with an exported snapshot; the published tables are
   * copied from that snapshot into the external tables in **one transaction** (`DELETE` + insert, so the previous rows
   * stay readable and the takeover can use them until the commit); then the old subscription is swapped for one on the
   * new slot without a copy (`copy_data = false`: it continues exactly after the snapshot). A failure drops the new
   * slot and leaves the previous copy as it was. Returns the new slot.
   */
  private async recopy(
    leader: string,
    members: SqlClient,
    external: SqlClient,
    status: { subscription: boolean; slot: string | null; published: string[] },
    addresses: string[],
  ): Promise<string> {
    const database = this.env['DB_DATABASE'] || 'loadweaver';

    if (status.subscription) await disableSubscription(external);

    const slot = this.slotName();
    const replication = await this.deps.connectMembers(leader, database, { replication: true });
    let created = false;
    let failure: unknown = null;

    try {
      const { snapshot } = await createSlotWithSnapshot(replication, slot);

      created = true;
      // Permanent right away: a failover during a long copy doesn't lose the new slot.
      await this.ensureFailoverSlot(leader, slot);

      const source = await this.deps.connectMembers(leader, database);

      try {
        const result = await copyDatabase(source, external, { snapshot, tables: status.published, keepReadable: true });

        this.logger.log(`External copy: ${result.rows} rows in ${result.tables} tables copied again (slot ${slot})`);
      } finally {
        await source.end().catch(() => undefined);
      }
    } catch (error) {
      failure = error;
    } finally {
      // Ends the snapshot export; the slot is inactive from here on.
      await replication.end().catch(() => undefined);
    }

    if (failure) {
      if (created) {
        await this.ensureFailoverSlot(leader, status.subscription ? status.slot : null);
        await dropSlot(members, slot).catch(() => undefined);
      }

      throw failure;
    }

    const old = await dropSubscription(external);

    if (old && old !== slot) await dropSlot(members, old).catch(() => undefined);

    await createSubscription(external, this.conninfo(addresses), {
      copyData: false,
      createSlot: false,
      slot,
      tables: status.published,
    });

    return slot;
  }

  /**
   * Registers the external copy's slot as a Patroni permanent logical slot (and removes earlier ones; `slot = null`:
   * only removes), through Patroni's dynamic configuration like `wal_level`. Best effort: true when registered.
   */
  private async ensureFailoverSlot(leader: string, slot: string | null): Promise<boolean> {
    try {
      const config = await this.deps.patroniGet(leader, '/config');
      const patch = permanentSlotPatch(config, slot, this.env['DB_DATABASE'] || 'loadweaver');

      if (patch) {
        const code = await this.deps.patroni(leader, 'PATCH', '/config', patch);

        if (code >= 300) throw new Error(`Patroni refused the configuration change (HTTP ${code})`);

        if (slot)
          this.logger.log(
            `External copy: slot ${slot} registered as a Patroni permanent logical slot (kept on the replicas across a failover)`,
          );
      }

      this.failoverSlotWarning = null;

      return slot !== null;
    } catch (error) {
      const text = message(error);

      if (text !== this.failoverSlotWarning)
        this.logger.warn(`External copy: slot not registered with Patroni (retried): ${text}`);

      this.failoverSlotWarning = text;

      return false;
    }
  }

  /** The audit event of the last switch, recorded on the database the process uses now. */
  private async recordPendingAudit(): Promise<void> {
    const pending = this.runtime.file?.pendingAudit;

    if (!pending) return;

    await this.audit.recordStandalone({
      actor: { type: 'system' },
      action: pending.action,
      target: 'control-plane/database',
      details: { handoverId: pending.handoverId, at: pending.at, ...pending.details },
    });
    await this.saveFile(this.file({ pendingAudit: null }));
  }

  private memberTls(ca: string): ClientConfig['ssl'] {
    return {
      ca,
      rejectUnauthorized: true,
      servername: POSTGRES_TLS_SERVER_NAME,
      checkServerIdentity: (_host, cert) => checkServerIdentity(POSTGRES_TLS_SERVER_NAME, cert),
    };
  }

  private external(): ExternalDatabase {
    if (this.runtime.external) return this.runtime.external;

    const options = this.dataSource.options as PostgresConnectionOptions;

    return {
      host: options.host ?? 'localhost',
      port: options.port ?? 5432,
      user: options.username ?? 'postgres',
      password: typeof options.password === 'string' ? options.password : '',
      database: options.database ?? 'loadweaver',
      ssl: (options.ssl as ClientConfig['ssl']) ?? false,
    };
  }

  private defaultDeps(): HandoverDeps {
    return {
      findPrimary: async (addresses) => await findMembersPrimary(addresses),
      findPrimaries: async (addresses) => await findMembersPrimaries(addresses),
      connectExternal: async () => await connectExternal(this.external(), 15_000),
      connectMembers: async (address, database, options) => {
        const client = new Client({
          host: address,
          port: MEMBER_POSTGRES_PORT,
          user: this.env['DB_USERNAME'] || 'postgres',
          password: this.env['DB_PASSWORD'] ?? '',
          database,
          ssl: this.memberTls(await this.caCertificate()),
          connectionTimeoutMillis: 15_000,
          application_name: 'loadweaver-database-handover',
          // Untyped in @types/pg: a logical replication connection (walsender) on `database`.
          ...(options?.replication ? { replication: 'database' } : {}),
        } as ClientConfig);

        guardClientErrors(client);
        await client.connect();

        return client;
      },
      migrate: async (target) => {
        const options = this.dataSource.options as PostgresConnectionOptions;
        const external = this.external();
        const connection =
          target === 'external'
            ? { host: external.host, port: external.port, ssl: external.ssl as PostgresConnectionOptions['ssl'] }
            : {
                host: target.address,
                port: MEMBER_POSTGRES_PORT,
                ssl: this.memberTls(await this.caCertificate()) as PostgresConnectionOptions['ssl'],
              };
        const source = new DataSource({
          ...options,
          ...connection,
          username: this.env['DB_USERNAME'] || options.username,
          password: this.env['DB_PASSWORD'] ?? options.password,
          database: this.env['DB_DATABASE'] || options.database,
          extra: {},
          migrationsRun: false,
          synchronize: false,
          logging: false,
        });

        await source.initialize();

        try {
          await source.runMigrations({ transaction: 'all' });
        } finally {
          await source.destroy();
        }
      },
      patroni: async (address, method, path, body) => {
        const host = address.includes(':') ? `[${address}]` : address;
        const res = await fetch(`http://${host}:${MEMBER_PATRONI_PORT}${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });

        return res.status;
      },
      patroniGet: async (address, path) => {
        const host = address.includes(':') ? `[${address}]` : address;
        const res = await fetch(`http://${host}:${MEMBER_PATRONI_PORT}${path}`, {
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) throw new Error(`Patroni GET ${path}: HTTP ${res.status}`);

        return (await res.json()) as unknown;
      },
      writeFile: async (file) => await writeDatabaseTargetFile(databaseStateDir(this.env), file),
      restart: () => {
        // SIGTERM runs the shutdown hooks; the container's restart policy (`unless-stopped`) starts it again.
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500).unref?.();
      },
      sleep: async (ms) => await new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    };
  }
}
