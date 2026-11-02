import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import {
  clusterSpecSchema,
  platformBackupSettings,
  type ClusterPlatformBackups,
} from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not } from 'typeorm';

import { ClusterEntity } from '../../entities/cluster.entity';
import { emailOf, userEmails } from '../../fleet-identity/user-emails';
import { NodeEntity } from '../../entities/node.entity';
import { ResourceEntity } from '../../entities/resource.entity';
import { AuditLogService, type AuditActor } from '../../services/audit-log.service';
import { NetworkStateService } from '../../services/network-state.service';
import { nodeAddress } from '../../services/object-store-controller.service';
import { BackupDeletionEntity, BackupEntity, BackupRetentionEntity } from '../backup.entities';
import { BackupKeyService } from '../backup-keys.service';
import { deletionDelayMs } from '../backup.utils';
import { DrEnvelopeService } from '../dr-envelope';
import { PlatformBackupStateEntity, PlatformRestoreEntity } from './platform-backups.entities';
import {
  CLONE_PORTS,
  cloneScope,
  drEnvelopeKey,
  etcdPrefix,
  etcdSnapshotName,
  openSearchBasePath,
  openSearchSnapshotName,
  PLATFORM_BACKUP_KINDS,
  platformResource,
  retentionVictims,
  scheduledRunDue,
  walgBackupsFromKeys,
  walgCommand,
  walgRetentionKeys,
  walgTargetKeys,
  walgPrefix,
  walgPushedBackup,
  walgResult,
  type PlatformBackupKind,
} from './platform-backups.utils';
import { PlatformBackupGrants, PlatformObjectStore } from './platform-object-store';
import { etcdSnapshotToFile, OpenSearchSnapshots, runOnLeader } from './platform-runners';
import { PlatformCopyService, type PlatformCopyTargetDto } from './platform-copy.service';
import {
  activePostgresScope,
  clusterUpdatedBy,
  platformKeepDecision,
  platformPins,
  platformRetentionKey,
} from './platform-dr.utils';
import { PLATFORM_BUCKET } from './s3-gateway.rules';
import { writesPaused } from '../../database-handover/database-target.runtime';

const TICK_MS = 60_000;
/** A run's lease; renewed never (runs are bounded by their own timeouts below). */
const LEASE_MS = 6 * 3_600_000;
const SNAPSHOT_TIMEOUT_MS = 2 * 3_600_000;
const GRANT_TTL_MS = 30 * 60_000;
/** A point-in-time clone that isn't serving after this long is failed (large databases take a while). */
const RESTORE_TIMEOUT_MS = Number(process.env['LOADWEAVER_PLATFORM_RESTORE_TIMEOUT_MS'] ?? 6 * 3_600_000);

export class PlatformBackupUnavailable extends Error {}

export interface PlatformBackupRunResult {
  kind: PlatformBackupKind;
  status: 'succeeded' | 'failed' | 'unavailable' | 'busy';
  backup: string | null;
  bytes: number;
  error: string | null;
  deleted: string[];
}

export interface PlatformBackupStatusDto {
  enabled: boolean;
  gateway: boolean;
  settings: ClusterPlatformBackups;
  kinds: {
    kind: PlatformBackupKind;
    enabled: boolean;
    schedule: string;
    keep: number;
    /** Retention in effect: a shortened `keep` waits for a second admin and the delay (3.20). */
    effectiveKeep: number;
    /** Open request shortening this kind's retention, if any. */
    retentionRequest: {
      id: string;
      keep: number;
      state: string;
      requestedBy: string;
      /** Requester / approver emails (`null`: deleted user / not a user), like Agenstra's `createdByEmail`. */
      requestedByEmail: string | null;
      approvedBy: string | null;
      approvedByEmail: string | null;
      notBefore: string;
    } | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    lastBackup: string | null;
    running: boolean;
    backups: {
      id: string;
      name: string | null;
      status: string;
      bytes: number;
      startedAt: string;
      finishedAt: string | null;
      /** External targets holding a copy (with object-lock end). */
      targets: { target: string; copiedAt: string; lockedUntil: string | null }[];
    }[];
  }[];
  /** Point-in-time recovery window of the control-plane database (oldest kept base backup → now). */
  postgresWindow: { from: string | null; to: string } | null;
  /** Patroni scope of the database (the cluster id, or a clone's scope after a cut-over). */
  postgresScope: string;
  restores: PlatformRestoreDto[];
  /** External copy per target (3.20). */
  copies: PlatformCopyTargetDto[];
  /** Pins (no external copy). */
  pins: string[];
  deletionDelayHours: number;
}

export interface PlatformRestoreDto {
  id: string;
  kind: 'postgres';
  state: string;
  node: string;
  scope: string;
  sourceScope: string;
  targetTime: string | null;
  error: string | null;
  requestedBy: string;
  createdAt: string;
  readyAt: string | null;
  finishedAt: string | null;
  /** Where the clone serves (member overlay address and ports). */
  endpoint: { host: string | null; port: number; patroniPort: number };
}

function actorId(actor: AuditActor): string {
  // A verified fleet person (3.24) is the acting person, not the fleet's service user.
  if (actor.person) return actor.person;

  return actor.id ? `${actor.type}:${actor.id}` : actor.type;
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

export function toRestoreDto(row: PlatformRestoreEntity, node: NodeEntity | undefined): PlatformRestoreDto {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    node: row.node,
    scope: row.scope,
    sourceScope: row.sourceScope,
    targetTime: row.targetTime?.toISOString() ?? null,
    error: row.error,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
    readyAt: row.readyAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    endpoint: { host: node?.overlayV4 ?? node?.overlayV6 ?? null, port: CLONE_PORTS.pg, patroniPort: CLONE_PORTS.api },
  };
}

/**
 * Backups of the control plane's own data (3.20): WAL-G base backups (WAL archived continuously by Spilo through
 * the gateway) for Postgres + TimescaleDB, OpenSearch snapshots, etcd snapshots; a DR envelope next to each one;
 * retention by the control plane only (delete grants for WAL-G / OpenSearch while it runs); the catalog in
 * `lw_backups` (`platform/<kind>`); point-in-time restores of Postgres into a new scope. Scheduled by a leaderless
 * tick on every replica: each run takes a lease on its kind's state row.
 */
@Injectable()
export class PlatformBackupsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PlatformBackupsService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  readonly grants: PlatformBackupGrants;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly store: PlatformObjectStore,
    private readonly envelopes: DrEnvelopeService,
    private readonly keys: BackupKeyService,
    private readonly audit: AuditLogService,
    @Optional() private readonly network?: NetworkStateService,
    @Optional() private readonly copies?: PlatformCopyService,
  ) {
    this.grants = new PlatformBackupGrants(dataSource);
  }

  /** Runs where the member's gateway runs (`LOADWEAVER_PLATFORM_BACKUPS=off` disables, `on` forces). */
  enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const mode = env['LOADWEAVER_PLATFORM_BACKUPS'];

    return mode === 'on' || (mode !== 'off' && !!env['LOADWEAVER_BACKUP_GATEWAY_LISTEN']);
  }

  onApplicationBootstrap(): void {
    if (!this.enabled()) return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (writesPaused('Platform backups', this.logger)) return;

    if (this.ticking) return;

    this.ticking = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Platform backups: ${message(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  async settings(): Promise<ClusterPlatformBackups> {
    const cluster = await this.dataSource.getRepository(ResourceEntity).findOne({ where: { kind: 'Cluster' } });
    const parsed = cluster ? clusterSpecSchema.safeParse(cluster.spec) : null;

    return platformBackupSettings(parsed?.success ? parsed.data.backups : undefined);
  }

  private async scope(): Promise<string> {
    const cluster = await this.dataSource.getRepository(ClusterEntity).findOne({ where: {} });

    if (!cluster) throw new Error('cluster not initialised');

    return cluster.clusterId;
  }

  /** Patroni scope of the control-plane database: the cluster id, or the clone's scope after a cut-over. */
  async postgresScope(): Promise<string> {
    return await activePostgresScope(this.dataSource, await this.scope());
  }

  /**
   * The retention (keep N) a kind runs with (3.20): a longer one applies at once; a shorter one keeps the previous
   * value and opens a request that needs a second admin's approval and the delay (3b's flow: `lw_backup_retention`,
   * `lw_backup_deletions` kind `retention`, executed by the backup scheduler).
   */
  async effectiveKeep(kind: PlatformBackupKind, wanted: number, now = new Date()): Promise<number> {
    const key = platformRetentionKey(kind);
    const repo = this.dataSource.getRepository(BackupRetentionEntity);
    const row = await repo.findOne({ where: { policy: key } });
    const effective = row && typeof row.effective['keep'] === 'number' ? row.effective['keep'] : null;
    const decision = platformKeepDecision(effective, wanted);
    const open = await this.dataSource
      .getRepository(BackupDeletionEntity)
      .createQueryBuilder('d')
      .where(`d.kind = 'retention' AND d.state IN ('pending', 'approved') AND d.retention->>'policy' = :key`, { key })
      .getMany();

    if (!row) await repo.save(repo.create({ policy: key, effective: { keep: decision.apply } }));
    else if (effective !== decision.apply) await repo.update({ policy: key }, { effective: { keep: decision.apply } });

    const same = open.find((d) => decision.shorten !== null && d.retention?.spec['keep'] === decision.shorten);

    for (const stale of open.filter((d) => d !== same))
      await this.dataSource.getRepository(BackupDeletionEntity).update({ id: stale.id }, { state: 'cancelled' });

    if (decision.shorten !== null && !same) {
      const requestedBy = (await clusterUpdatedBy(this.dataSource)) ?? 'unknown';

      await this.dataSource.transaction(async (manager) => {
        const deletion = await manager.getRepository(BackupDeletionEntity).save(
          manager.getRepository(BackupDeletionEntity).create({
            kind: 'retention',
            scope: 'cluster',
            backupIds: [],
            retention: { policy: key, project: null, spec: { keep: decision.shorten } },
            reason: `retention of the ${kind} platform backups shortened from ${decision.apply} to ${decision.shorten}`,
            state: 'pending',
            requestedBy,
            approvedBy: null,
            approvedAt: null,
            notBefore: new Date(now.getTime() + deletionDelayMs()),
            executedAt: null,
          }),
        );

        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'backup.retention-shortening-requested',
          target: `cluster/backups.platform/${kind}`,
          details: { request: deletion.id, keep: decision.shorten, effective: decision.apply },
        });
      });
    }

    return decision.apply;
  }

  private async state(kind: PlatformBackupKind, now: Date): Promise<PlatformBackupStateEntity> {
    const repo = this.dataSource.getRepository(PlatformBackupStateEntity);

    await repo.createQueryBuilder().insert().values({ kind, firstSeenAt: now }).orIgnore().execute();

    return (await repo.findOne({ where: { kind } })) as PlatformBackupStateEntity;
  }

  /** One scheduler pass: due backups (with retention afterwards) and restore progress. */
  async tick(now = new Date()): Promise<PlatformBackupRunResult[]> {
    const settings = await this.settings();
    const results: PlatformBackupRunResult[] = [];

    if (settings.enabled) {
      for (const kind of PLATFORM_BACKUP_KINDS) {
        // Shortened retention opens its approval request as soon as the plan is applied, not at the next run.
        await this.effectiveKeep(kind, settings[kind].keep, now);

        if (!settings[kind].enabled) continue;

        const state = await this.state(kind, now);
        const due = scheduledRunDue(
          settings[kind].schedule,
          settings.timeZone,
          now,
          state.lastStartedAt,
          state.firstSeenAt,
        );

        if (due) results.push(await this.run(kind, { type: 'system' }, now));
      }
    }

    await this.watchRestores(now);

    return results;
  }

  private async lease(kind: PlatformBackupKind, now: Date): Promise<boolean> {
    await this.state(kind, now);

    const result: [unknown[], number] = await this.dataSource.query(
      `UPDATE lw_platform_backup_state SET running_until = $2, last_started_at = $3
       WHERE kind = $1 AND (running_until IS NULL OR running_until < $3) RETURNING kind`,
      [kind, new Date(now.getTime() + LEASE_MS), now],
    );

    return Array.isArray(result[0]) ? result[0].length > 0 : (result as unknown as unknown[]).length > 0;
  }

  /** Backs one kind up now (schedule or "back up now"), then applies its retention. */
  async run(kind: PlatformBackupKind, actor: AuditActor, now = new Date()): Promise<PlatformBackupRunResult> {
    const paused = await this.store.writesPaused();

    if (paused) return { kind, status: 'busy', backup: null, bytes: 0, error: paused, deleted: [] };

    if (!(await this.lease(kind, now)))
      return { kind, status: 'busy', backup: null, bytes: 0, error: 'a run is in progress', deleted: [] };

    const settings = await this.settings();
    const scope = await this.scope();
    const postgresScope = await this.postgresScope();
    const { generation } = await this.keys.current();
    const catalog = this.dataSource.getRepository(BackupEntity);
    const row = await catalog.save(
      catalog.create({
        scope: 'cluster',
        project: null,
        resource: platformResource(kind),
        policy: 'cluster:backups.platform',
        node: null,
        status: 'running',
        snapshotId: null,
        keyGeneration: generation,
        startedAt: now,
        targets: [],
      }),
    );
    let result: PlatformBackupRunResult;

    try {
      const done = await this.backup(kind, kind === 'postgres' ? postgresScope : scope);
      const at = new Date();

      // The DR envelope next to every control-plane backup (master key, CA, environment; under the backup key),
      // naming the backup and the database scope it belongs to (a fresh node reads it first, 3.20).
      await this.putObject(
        drEnvelopeKey(done.name),
        Buffer.from(
          JSON.stringify(
            await this.envelopes.seal(process.env, {
              kind,
              name: done.name,
              postgresScope,
              finishedAt: at.toISOString(),
            }),
          ),
        ),
        true,
      );
      await catalog.update(
        { id: row.id },
        {
          status: 'succeeded',
          snapshotId: done.name,
          bytes: done.bytes,
          uploadedBytes: done.uploadedBytes,
          finishedAt: at,
          targets: [{ target: 'garage', copiedAt: at.toISOString(), lockedUntil: null }],
        },
      );
      result = { kind, status: 'succeeded', backup: done.name, bytes: done.bytes, error: null, deleted: [] };
    } catch (error) {
      const unavailable = error instanceof PlatformBackupUnavailable;

      // A kind that can't run here (e.g. no repository-s3 plugin) is no failed backup: no catalog row, so 3a's
      // `builtin:backup-failed` alert (newest row per resource) only fires for real failures.
      if (unavailable) await catalog.delete({ id: row.id });
      else await catalog.update({ id: row.id }, { status: 'failed', error: message(error), finishedAt: new Date() });
      result = {
        kind,
        status: unavailable ? 'unavailable' : 'failed',
        backup: null,
        bytes: 0,
        error: message(error),
        deleted: [],
      };
    }

    if (result.status === 'succeeded') {
      try {
        result.deleted = await this.retention(
          kind,
          kind === 'postgres' ? postgresScope : scope,
          await this.effectiveKeep(kind, settings[kind].keep, now),
        );
      } catch (error) {
        this.logger.warn(`Retention of ${kind} backups failed: ${message(error)}`);
      }

      // The new backup (and its envelope) go to the external targets right away.
      this.copies?.kick();
    }

    await this.dataSource.getRepository(PlatformBackupStateEntity).update(
      { kind },
      {
        runningUntil: null,
        lastFinishedAt: new Date(),
        lastStatus: result.status === 'busy' ? null : result.status,
        lastError: result.error,
        lastBackup: result.backup,
      },
    );
    await this.audit.recordStandalone({
      actor,
      action: result.status === 'succeeded' ? 'backup.platform-completed' : 'backup.platform-failed',
      target: platformResource(kind),
      details: { backup: result.backup, bytes: result.bytes, error: result.error, deleted: result.deleted },
    });

    if (result.status === 'failed') this.logger.warn(`Platform backup ${kind} failed: ${result.error}`);

    return result;
  }

  private async backup(
    kind: PlatformBackupKind,
    scope: string,
  ): Promise<{ name: string; bytes: number; uploadedBytes: number }> {
    switch (kind) {
      case 'postgres':
        return await this.postgresBaseBackup(scope);
      case 'opensearch':
        return await this.openSearchSnapshot(scope);
      case 'etcd':
        return await this.etcdSnapshot(scope);
    }
  }

  /** `wal-g backup-push` on the leader; the WAL in between is archived by Spilo continuously. */
  private async postgresBaseBackup(scope: string): Promise<{ name: string; bytes: number; uploadedBytes: number }> {
    const [{ data_directory: dataDirectory }] = (await this.dataSource.query('SHOW data_directory')) as {
      data_directory: string;
    }[];
    const result = walgResult(await runOnLeader(this.dataSource, walgCommand('backup-push', dataDirectory)));

    if (result.exitCode !== 0)
      throw new Error(`wal-g backup-push exited with ${result.exitCode}: ${result.output.slice(-1500)}`);

    const name = walgPushedBackup(result.output);

    if (!name) throw new Error(`wal-g backup-push reported no backup name: ${result.output.slice(-500)}`);

    const bytes = await this.prefixBytes(`${walgPrefix(scope)}basebackups_005/${name}/`);

    return { name, bytes, uploadedBytes: bytes };
  }

  private openSearch(): OpenSearchSnapshots {
    const node = process.env['OPENSEARCH_NODE'];

    if (!node || process.env['OPENSEARCH_ENABLED'] === 'false')
      throw new PlatformBackupUnavailable('no log store on this member');

    return new OpenSearchSnapshots(node);
  }

  private async openSearchSnapshot(scope: string): Promise<{ name: string; bytes: number; uploadedBytes: number }> {
    const os = this.openSearch();

    if (!(await os.hasRepositoryPlugin()))
      throw new PlatformBackupUnavailable('the OpenSearch image has no repository-s3 plugin (release images have it)');

    await os.ensureRepository(PLATFORM_BUCKET, openSearchBasePath(scope));

    const name = openSearchSnapshotName(new Date());
    const snapshot = await os.snapshot(name, SNAPSHOT_TIMEOUT_MS);

    if (snapshot.state !== 'SUCCESS')
      throw new Error(
        `snapshot ${name} ended ${snapshot.state} (${snapshot.shards.failed} of ${snapshot.shards.total} shards failed)`,
      );

    const sizes = await os.sizes(name);

    return { name, bytes: sizes.total, uploadedBytes: sizes.incremental };
  }

  private async etcdSnapshot(scope: string): Promise<{ name: string; bytes: number; uploadedBytes: number }> {
    const endpoint = process.env['LOADWEAVER_ETCD_ENDPOINT'] || 'http://127.0.0.1:2379';
    const dir = await mkdtemp(join(tmpdir(), 'lw-etcd-'));
    const file = join(dir, 'snapshot.db');
    const name = etcdSnapshotName(new Date());

    try {
      const bytes = await etcdSnapshotToFile(endpoint, file, SNAPSHOT_TIMEOUT_MS);
      const size = (await stat(file)).size;

      await this.putObject(`${etcdPrefix(scope)}${name}.db`, { path: file, size }, false);

      return { name, bytes, uploadedBytes: bytes };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async withClient<T>(fn: (client: S3Client) => Promise<T>): Promise<T> {
    const client = await this.store.client();

    try {
      return await fn(client);
    } finally {
      client.destroy();
    }
  }

  /** The control plane's own writes: never over an existing object (unless `replace`, for envelopes re-sealed). */
  private async putObject(key: string, body: Buffer | { path: string; size: number }, replace: boolean): Promise<void> {
    await this.withClient(async (client) => {
      if (!replace) {
        const exists = await client
          .send(new HeadObjectCommand({ Bucket: PLATFORM_BUCKET, Key: key }))
          .then(() => true)
          .catch((error: unknown) => {
            if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return false;

            throw error;
          });

        if (exists) throw new Error(`${key} exists already`);
      }

      await client.send(
        new PutObjectCommand({
          Bucket: PLATFORM_BUCKET,
          Key: key,
          ...(Buffer.isBuffer(body)
            ? { Body: body, ContentType: 'application/json' }
            : { Body: createReadStream(body.path), ContentLength: body.size, ContentType: 'application/octet-stream' }),
        }),
      );
    });
  }

  private async listKeys(prefix: string): Promise<{ key: string; size: number }[]> {
    return await this.withClient(async (client) => {
      const keys: { key: string; size: number }[] = [];
      let token: string | undefined;

      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: PLATFORM_BUCKET, Prefix: prefix, ContinuationToken: token }),
        );

        for (const c of page.Contents ?? []) if (c.Key) keys.push({ key: c.Key, size: c.Size ?? 0 });

        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);

      return keys;
    });
  }

  private async prefixBytes(prefix: string): Promise<number> {
    return (await this.listKeys(prefix)).reduce((sum, k) => sum + k.size, 0);
  }

  private async deleteKeys(keys: string[]): Promise<void> {
    await this.withClient(async (client) => {
      for (let i = 0; i < keys.length; i += 1000) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: PLATFORM_BUCKET,
            Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
    });
  }

  /**
   * Retention by the control plane only (3.20): keeps the newest `keep`; WAL-G and OpenSearch delete through the
   * gateway under a grant that exists for this run only; etcd snapshots and envelopes are the control plane's own.
   * Then the catalog follows what is really in the bucket.
   */
  async retention(kind: PlatformBackupKind, scope: string, keep: number): Promise<string[]> {
    const existingBefore = await this.existing(kind, scope);
    const victims = retentionVictims(existingBefore, keep).map((v) => v.name);

    if (victims.length > 0) {
      switch (kind) {
        case 'postgres': {
          // `delete before` the oldest kept backup: the victims are known up front, so the grant names exactly
          // the keys WAL-G may remove (M6 review L4) instead of the whole scope.
          const kept = existingBefore.map((e) => e.name).filter((n) => !victims.includes(n));
          const target = kept.sort()[0];

          if (!target) break;

          const grant = await this.grants.open(
            'postgres',
            walgPrefix(scope),
            'retention',
            GRANT_TTL_MS,
            walgRetentionKeys(
              walgPrefix(scope),
              (await this.listKeys(walgPrefix(scope))).map((k) => k.key),
              victims,
              target,
            ),
          );

          try {
            const result = walgResult(
              await runOnLeader(this.dataSource, walgCommand(`delete before FIND_FULL ${target} --confirm`)),
            );

            if (result.exitCode !== 0)
              throw new Error(`wal-g delete exited with ${result.exitCode}: ${result.output.slice(-1500)}`);
          } finally {
            await this.grants.close(grant);
          }

          break;
        }
        case 'opensearch': {
          const grant = await this.grants.open(
            'opensearch',
            `${openSearchBasePath(scope)}/`,
            'retention',
            GRANT_TTL_MS,
          );

          try {
            await this.openSearch().delete(victims, SNAPSHOT_TIMEOUT_MS);
          } finally {
            await this.grants.close(grant);
          }

          break;
        }
        case 'etcd':
          await this.deleteKeys(victims.map((v) => `${etcdPrefix(scope)}${v}.db`));
          break;
      }
    }

    const remaining = new Set((await this.existing(kind, scope)).map((e) => e.name));
    const gone = existingBefore.map((e) => e.name).filter((n) => !remaining.has(n));

    await this.deleteKeys(gone.map(drEnvelopeKey));
    await this.syncCatalog(kind, remaining);

    return gone;
  }

  /** What exists in the bucket (or repository) for a kind, with start times. */
  private async existing(kind: PlatformBackupKind, scope: string): Promise<{ name: string; startedAt: Date }[]> {
    const catalog = await this.dataSource
      .getRepository(BackupEntity)
      .find({ where: { resource: platformResource(kind), deletedAt: IsNull(), status: 'succeeded' } });
    const startedAt = new Map(catalog.map((r) => [r.snapshotId, r.startedAt]));

    switch (kind) {
      case 'postgres': {
        const keys = await this.listKeys(`${walgPrefix(scope)}basebackups_005/`);

        return walgBackupsFromKeys(
          walgPrefix(scope),
          keys.map((k) => k.key),
        ).map((name) => ({ name, startedAt: startedAt.get(name) ?? new Date(0) }));
      }
      case 'opensearch':
        return (await this.openSearch().list()).map((s) => ({ name: s.name, startedAt: s.startedAt }));
      case 'etcd':
        return (await this.listKeys(etcdPrefix(scope)))
          .map((k) => k.key.slice(etcdPrefix(scope).length).replace(/\.db$/, ''))
          .filter((n) => /^etcd-\d{8}t\d{6}z$/.test(n))
          .map((name) => ({ name, startedAt: startedAt.get(name) ?? new Date(0) }));
    }
  }

  private async syncCatalog(kind: PlatformBackupKind, remaining: Set<string>): Promise<void> {
    const repo = this.dataSource.getRepository(BackupEntity);
    const rows = await repo.find({
      where: { resource: platformResource(kind), deletedAt: IsNull(), status: 'succeeded' },
    });
    const gone = rows.filter((r) => r.snapshotId && !remaining.has(r.snapshotId)).map((r) => r.id);

    if (gone.length > 0) await repo.update({ id: In(gone) }, { deletedAt: new Date() });
  }

  /**
   * Deletes platform backups after an approved deletion request (second admin + delay, 3.20): WAL-G and OpenSearch
   * delete under a grant like retention does, etcd snapshots and envelopes are the control plane's own objects.
   */
  async deleteBackups(rows: BackupEntity[], actor: AuditActor, reason: string): Promise<void> {
    const scope = await this.scope();
    const postgresScope = await this.postgresScope();

    for (const row of rows) {
      const kind = row.resource.slice('platform/'.length) as PlatformBackupKind;
      const name = row.snapshotId;

      if (name && row.status === 'succeeded') {
        switch (kind) {
          case 'postgres': {
            if (!/^base_[0-9A-F]{24}(_D_[0-9A-F]{24})?$/.test(name)) throw new Error(`invalid backup name ${name}`);

            const grant = await this.grants.open(
              'postgres',
              walgPrefix(postgresScope),
              'deletion',
              GRANT_TTL_MS,
              walgTargetKeys(
                walgPrefix(postgresScope),
                (await this.listKeys(`${walgPrefix(postgresScope)}basebackups_005/`)).map((k) => k.key),
                name,
              ),
            );

            try {
              const result = walgResult(
                await runOnLeader(this.dataSource, walgCommand(`delete target ${name} --confirm`)),
              );

              if (result.exitCode !== 0)
                throw new Error(`wal-g delete target exited with ${result.exitCode}: ${result.output.slice(-1500)}`);
            } finally {
              await this.grants.close(grant);
            }

            break;
          }
          case 'opensearch': {
            const grant = await this.grants.open(
              'opensearch',
              `${openSearchBasePath(scope)}/`,
              'deletion',
              GRANT_TTL_MS,
            );

            try {
              await this.openSearch().delete([name], SNAPSHOT_TIMEOUT_MS);
            } finally {
              await this.grants.close(grant);
            }

            break;
          }
          case 'etcd':
            await this.deleteKeys([`${etcdPrefix(scope)}${name}.db`]);
            break;
        }

        await this.deleteKeys([drEnvelopeKey(name)]);
      }

      await this.dataSource.getRepository(BackupEntity).update({ id: row.id }, { deletedAt: new Date(), keep: [] });
    }

    await this.audit.recordStandalone({
      actor,
      action: 'backup.deleted',
      target: 'platform',
      details: { backups: rows.map((r) => r.id), names: rows.map((r) => r.snapshotId), reason },
    });
  }

  async status(): Promise<PlatformBackupStatusDto> {
    const settings = await this.settings();
    const states = new Map(
      (await this.dataSource.getRepository(PlatformBackupStateEntity).find()).map((s) => [s.kind, s]),
    );
    const rows = await this.dataSource.getRepository(BackupEntity).find({
      where: { resource: In(PLATFORM_BACKUP_KINDS.map(platformResource)), deletedAt: IsNull() },
      order: { startedAt: 'DESC' },
      take: 500,
    });
    const now = new Date();
    const postgres = rows.filter((r) => r.resource === platformResource('postgres') && r.status === 'succeeded');
    // Recovery is possible from the end of the oldest kept base backup on.
    const oldest = postgres.length ? (postgres[postgres.length - 1].finishedAt ?? null) : null;
    const retention = new Map(
      (
        await this.dataSource
          .getRepository(BackupRetentionEntity)
          .find({ where: { policy: In(PLATFORM_BACKUP_KINDS.map(platformRetentionKey)) } })
      ).map((r) => [r.policy, r.effective['keep']]),
    );
    const requests = await this.dataSource
      .getRepository(BackupDeletionEntity)
      .createQueryBuilder('d')
      .where(`d.kind = 'retention' AND d.state IN ('pending', 'approved') AND d.retention->>'policy' LIKE :prefix`, {
        prefix: 'cluster:backups.platform/%',
      })
      .getMany();
    const copies = (await this.copies?.status()) ?? [];
    const emails = await userEmails(
      this.dataSource,
      requests.flatMap((d) => [d.requestedBy, d.approvedBy]),
    );

    return {
      enabled: settings.enabled,
      gateway: this.enabled(),
      settings,
      kinds: PLATFORM_BACKUP_KINDS.map((kind) => {
        const state = states.get(kind);

        return {
          kind,
          enabled: settings[kind].enabled,
          schedule: settings[kind].schedule,
          keep: settings[kind].keep,
          effectiveKeep: retention.get(platformRetentionKey(kind)) ?? settings[kind].keep,
          retentionRequest:
            requests
              .filter((d) => d.retention?.policy === platformRetentionKey(kind))
              .map((d) => ({
                id: d.id,
                keep: Number(d.retention?.spec['keep']),
                state: d.state,
                requestedBy: d.requestedBy,
                requestedByEmail: emailOf(emails, d.requestedBy),
                approvedBy: d.approvedBy,
                approvedByEmail: emailOf(emails, d.approvedBy),
                notBefore: d.notBefore.toISOString(),
              }))[0] ?? null,
          lastStartedAt: state?.lastStartedAt?.toISOString() ?? null,
          lastFinishedAt: state?.lastFinishedAt?.toISOString() ?? null,
          lastStatus: state?.lastStatus ?? null,
          lastError: state?.lastError ?? null,
          lastBackup: state?.lastBackup ?? null,
          running: !!state?.runningUntil && state.runningUntil > now,
          backups: rows
            .filter((r) => r.resource === platformResource(kind))
            .slice(0, 100)
            .map((r) => ({
              id: r.id,
              name: r.snapshotId,
              status: r.status,
              bytes: r.bytes,
              startedAt: r.startedAt.toISOString(),
              finishedAt: r.finishedAt?.toISOString() ?? null,
              targets: r.targets.filter((t) => t.target !== 'garage'),
            })),
        };
      }),
      postgresWindow: settings.postgres.enabled ? { from: oldest?.toISOString() ?? null, to: now.toISOString() } : null,
      postgresScope: await this.postgresScope().catch(() => ''),
      restores: await this.restores(),
      copies,
      pins: platformPins(settings, copies.filter((c) => c.declared).length),
      deletionDelayHours: deletionDelayMs() / 3_600_000,
    };
  }

  // --- Point-in-time restore of Postgres (3.20) --------------------------------------------------------------

  async restores(): Promise<PlatformRestoreDto[]> {
    const rows = await this.dataSource
      .getRepository(PlatformRestoreEntity)
      .find({ order: { createdAt: 'DESC' }, take: 50 });
    const nodes = new Map((await this.dataSource.getRepository(NodeEntity).find()).map((n) => [n.name, n]));

    return rows.map((r) => toRestoreDto(r, nodes.get(r.node)));
  }

  /**
   * Starts a point-in-time clone of the control-plane database into a new Patroni scope on one member (side by
   * side; the running cluster is untouched). The member must speak `platform-backups`. Target time defaults to the
   * end of the archive and must lie inside the recovery window.
   */
  async requestRestore(
    input: { targetTime?: string; node?: string },
    actor: AuditActor,
    now = new Date(),
  ): Promise<PlatformRestoreDto> {
    const target = input.targetTime ? new Date(input.targetTime) : null;

    if (target && Number.isNaN(target.getTime())) throw new BadRequestException('targetTime must be an ISO 8601 time');

    if (target && target.getTime() > now.getTime()) throw new BadRequestException('targetTime lies in the future');

    const bases = await this.dataSource.getRepository(BackupEntity).find({
      where: { resource: platformResource('postgres'), status: 'succeeded', deletedAt: IsNull() },
      order: { startedAt: 'ASC' },
    });

    if (bases.length === 0) throw new BadRequestException('there is no base backup to restore from yet');

    if (target && bases[0].finishedAt && target.getTime() < bases[0].finishedAt.getTime())
      throw new BadRequestException(
        `targetTime lies before the recovery window (from ${bases[0].finishedAt.toISOString()})`,
      );

    const members = (
      await this.dataSource
        .getRepository(NodeEntity)
        .find({ where: { controlPlane: true, witness: false, lifecycle: Not('left') }, order: { name: 'ASC' } })
    ).filter((n) => n.protocolFeatures.includes('platform-backups'));
    const node = input.node ? members.find((n) => n.name === input.node) : members.find((n) => n.connected);

    if (!node)
      throw new BadRequestException(
        input.node
          ? `${input.node} is not a control-plane member with platform backups`
          : 'no connected control-plane member supports platform backups',
      );

    const scope = await this.scope();
    const sourceScope = await this.postgresScope();
    const repo = this.dataSource.getRepository(PlatformRestoreEntity);
    const row = await this.dataSource.transaction(async (manager) => {
      const restores = manager.getRepository(PlatformRestoreEntity);

      if (await restores.findOne({ where: { kind: 'postgres', state: In(['requested', 'restoring', 'ready']) } }))
        throw new ConflictException('a point-in-time restore is active; discard it first');

      const created = restores.create({
        kind: 'postgres',
        state: 'requested',
        node: node.name,
        scope: 'pending',
        sourceScope,
        targetTime: target,
        error: null,
        requestedBy: actorId(actor),
        readyAt: null,
        finishedAt: null,
      });
      const saved = await restores.save(created);

      saved.scope = cloneScope(scope, saved.id);
      await restores.update({ id: saved.id }, { scope: saved.scope });
      await this.audit.record(manager, {
        actor,
        action: 'backup.platform-restore-requested',
        target: `platform/postgres/restore/${saved.id}`,
        details: { node: node.name, scope: saved.scope, targetTime: target?.toISOString() ?? 'latest' },
      });

      return saved;
    });

    this.network?.requestRecompile('platform restore requested');

    return toRestoreDto((await repo.findOne({ where: { id: row.id } })) as PlatformRestoreEntity, node);
  }

  /** Stops the clone and removes its data on the member (the restore stays in the history). */
  async discardRestore(id: string, actor: AuditActor): Promise<PlatformRestoreDto> {
    const row = await this.dataSource.transaction(async (manager) => {
      const restores = manager.getRepository(PlatformRestoreEntity);
      const current = await restores.findOne({ where: { id } });

      if (!current) throw new NotFoundException('restore not found');

      if (current.state === 'discarded') return current;

      await restores.update({ id }, { state: 'discarded', finishedAt: new Date() });
      await this.audit.record(manager, {
        actor,
        action: 'backup.platform-restore-discarded',
        target: `platform/postgres/restore/${id}`,
        details: { scope: current.scope },
      });

      return (await restores.findOne({ where: { id } })) as PlatformRestoreEntity;
    });

    this.network?.requestRecompile('platform restore discarded');

    return toRestoreDto(
      row,
      (await this.dataSource.getRepository(NodeEntity).findOne({ where: { name: row.node } })) ?? undefined,
    );
  }

  /** Where a clone's Patroni REST API is reached (overridable for tests). */
  protected patroniUrl(node: NodeEntity): string | null {
    const address = nodeAddress(node);

    return address ? `http://${address}:${CLONE_PORTS.api}/patroni` : null;
  }

  /** Follows active restores: `restoring` once Patroni answers, `ready` once the clone runs as primary. */
  async watchRestores(now = new Date()): Promise<void> {
    const repo = this.dataSource.getRepository(PlatformRestoreEntity);
    const active = await repo.find({ where: { state: In(['requested', 'restoring']) } });

    for (const row of active) {
      const node = await this.dataSource.getRepository(NodeEntity).findOne({ where: { name: row.node } });
      const url = node ? this.patroniUrl(node) : null;
      let patroni: { state?: string; role?: string } | null = null;

      if (url) {
        patroni = await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: 'error' })
          .then(async (res) => (await res.json()) as { state?: string; role?: string })
          .catch(() => null);
      }

      if (patroni?.state === 'running' && (patroni.role === 'master' || patroni.role === 'primary')) {
        await repo.update({ id: row.id }, { state: 'ready', readyAt: now });
        await this.audit.recordStandalone({
          actor: { type: 'system' },
          action: 'backup.platform-restore-ready',
          target: `platform/postgres/restore/${row.id}`,
          details: { scope: row.scope, node: row.node },
        });
      } else if (now.getTime() - row.createdAt.getTime() > RESTORE_TIMEOUT_MS) {
        await repo.update(
          { id: row.id },
          {
            state: 'failed',
            finishedAt: now,
            error: `the clone did not become primary (${patroni?.state ?? 'unreachable'})`,
          },
        );
        this.network?.requestRecompile('platform restore failed');
      } else if (patroni && row.state === 'requested') {
        await repo.update({ id: row.id }, { state: 'restoring' });
      }
    }
  }

  // --- OpenSearch restore and etcd download ------------------------------------------------------------------

  /** Index-level restore from a snapshot; restored indices get `renamePrefix` (default `restored-`). */
  async restoreOpenSearch(
    input: { snapshot: string; indices: string[]; renamePrefix?: string },
    actor: AuditActor,
  ): Promise<{ indices: string[]; failedShards: number }> {
    const os = this.openSearch();
    const snapshot = (await os.list()).find((s) => s.name === input.snapshot);

    if (!snapshot) throw new NotFoundException('snapshot not found');

    const prefix = input.renamePrefix ?? 'restored-';
    const result = await os.restore(input.snapshot, input.indices, prefix, SNAPSHOT_TIMEOUT_MS);

    await this.audit.recordStandalone({
      actor,
      action: 'backup.platform-opensearch-restored',
      target: `platform/opensearch/${input.snapshot}`,
      details: { indices: result.indices, renamePrefix: prefix, failedShards: result.shards.failed },
    });

    return { indices: result.indices, failedShards: result.shards.failed };
  }

  /** An etcd snapshot as stored (for the documented `etcdutl snapshot restore`, DR bootstrap). */
  async etcdSnapshotStream(name: string, actor: AuditActor): Promise<{ body: NodeJS.ReadableStream; size: number }> {
    if (!/^etcd-\d{8}t\d{6}z$/.test(name)) throw new BadRequestException('invalid snapshot name');

    const scope = await this.scope();
    const client = await this.store.client();

    try {
      const object = await client.send(
        new GetObjectCommand({ Bucket: PLATFORM_BUCKET, Key: `${etcdPrefix(scope)}${name}.db` }),
      );

      await this.audit.recordStandalone({
        actor,
        action: 'backup.platform-etcd-downloaded',
        target: `platform/etcd/${name}`,
      });

      const body = object.Body as NodeJS.ReadableStream;

      body.on('end', () => client.destroy());
      body.on('error', () => client.destroy());

      return { body, size: object.ContentLength ?? 0 };
    } catch (error) {
      client.destroy();

      if ((error as { name?: string }).name === 'NoSuchKey') throw new NotFoundException('snapshot not found');

      throw error;
    }
  }
}
