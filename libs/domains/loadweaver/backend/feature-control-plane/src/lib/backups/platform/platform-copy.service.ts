import { createHash } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { BackupTargetSpec } from '@forepath/loadweaver/shared/util-model';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThanOrEqual } from 'typeorm';

import { ClusterEntity } from '../../entities/cluster.entity';
import { PlatformCredentialsService } from '../../services/platform-credentials.service';
import { BackupEntity, BackupKeyEntity } from '../backup.entities';
import { BackupKeyService } from '../backup-keys.service';
import { openDrEnvelope, type DrEnvelope } from '../dr-envelope';
import { PlatformBackupStateEntity } from './platform-backups.entities';
import { PLATFORM_BACKUP_KINDS, platformResource } from './platform-backups.utils';
import {
  copyKeyOf,
  copyVerificationError,
  decryptStream,
  DR_CLUSTER_KEY,
  DR_KEYS_KEY,
  encryptedSize,
  encryptStream,
  objectsToCopy,
  platformCopyKey,
  type SourceObject,
} from './platform-copy.utils';
import { S3CopyDestination, SftpCopyDestination, type CopyDestination } from './platform-copy.destinations';
import { PlatformCopyEntity, PlatformCopyTargetEntity } from './platform-dr.entities';
import {
  activePostgresScope,
  declaredBackupTargets,
  DR_INFO_FORMAT,
  drInfoTarget,
  platformCopyTargets,
  platformSettings,
  type DrInfoDocument,
  type DrInfoKey,
} from './platform-dr.utils';
import { PlatformObjectStore } from './platform-object-store';
import { PLATFORM_BUCKET } from './s3-gateway.rules';

const LEASE_KIND = 'external-copy';
const LEASE_MS = 6 * 3_600_000;
const DEFAULT_INTERVAL_MS = 5 * 60_000;

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

export interface PlatformCopyTargetDto {
  target: string;
  type: 's3' | 'sftp' | null;
  declared: boolean;
  objectLock: { mode: string; days: number } | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  objects: number;
  bytes: number;
  verifiedEnvelope: string | null;
  verifiedAt: string | null;
}

export interface PlatformCopyPassResult {
  target: string;
  status: 'succeeded' | 'failed';
  copied: number;
  pruned: number;
  error: string | null;
}

/** MD5 of the bytes that pass through (S3's ETag of a single-part upload), for verification after the upload. */
function md5Stream(): Transform & { digest: () => string } {
  const hash = createHash('md5');
  let digest: string | null = null;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  }) as Transform & { digest: () => string };

  stream.digest = () => (digest ??= hash.digest('hex'));

  return stream;
}

/**
 * External copies of the platform bucket (3.20): WAL-G's archive and base backups, OpenSearch and etcd snapshots and
 * the DR envelopes go to the cluster's external `BackupTarget`s, encrypted with the backup key before they leave,
 * verified after each upload (size, and the ETag for S3), with object-lock retention on S3 targets that declare it.
 * Runs after every platform backup and every few minutes (WAL is archived continuously). A pass also writes the small
 * DR descriptions (cluster id, key generations) a fresh node reads first, and reads the newest envelope back to prove
 * the copy decrypts. Objects removed from the bucket by retention are removed from the target once their lock ended
 * (append-only credentials simply keep them).
 */
@Injectable()
export class PlatformCopyService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PlatformCopyService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<PlatformCopyPassResult[]> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly store: PlatformObjectStore,
    private readonly keys: BackupKeyService,
    private readonly credentials: PlatformCredentialsService,
  ) {}

  private enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const mode = env['LOADWEAVER_PLATFORM_BACKUPS'];

    return mode === 'on' || (mode !== 'off' && !!env['LOADWEAVER_BACKUP_GATEWAY_LISTEN']);
  }

  onApplicationBootstrap(): void {
    if (!this.enabled()) return;

    const interval = Number(process.env['LOADWEAVER_PLATFORM_COPY_INTERVAL_MS'] ?? DEFAULT_INTERVAL_MS);

    this.timer = setInterval(() => this.kick(), Number.isFinite(interval) && interval >= 10_000 ? interval : 300_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Starts a pass unless one runs on this replica (e.g. right after a platform backup). */
  kick(): void {
    if (!this.enabled()) return;

    void this.run().catch((error: unknown) => this.logger.warn(`External copy: ${message(error)}`));
  }

  async run(now = new Date()): Promise<PlatformCopyPassResult[]> {
    if (this.running) return await this.running;

    this.running = this.pass(now).finally(() => (this.running = null));

    return await this.running;
  }

  private async lease(now: Date): Promise<boolean> {
    const repo = this.dataSource.getRepository(PlatformBackupStateEntity);

    await repo.createQueryBuilder().insert().values({ kind: LEASE_KIND, firstSeenAt: now }).orIgnore().execute();

    const result: [unknown[], number] = await this.dataSource.query(
      `UPDATE lw_platform_backup_state SET running_until = $2, last_started_at = $3
       WHERE kind = $1 AND (running_until IS NULL OR running_until < $3) RETURNING kind`,
      [LEASE_KIND, new Date(now.getTime() + LEASE_MS), now],
    );

    return Array.isArray(result[0]) ? result[0].length > 0 : (result as unknown as unknown[]).length > 0;
  }

  private async release(status: string, error: string | null): Promise<void> {
    await this.dataSource
      .getRepository(PlatformBackupStateEntity)
      .update(
        { kind: LEASE_KIND },
        { runningUntil: null, lastFinishedAt: new Date(), lastStatus: status as 'succeeded', lastError: error },
      );
  }

  /** The configured targets (copy destinations are opened per pass). */
  async targets(): Promise<{ targets: Array<{ name: string; spec: BackupTargetSpec }>; missing: string[] }> {
    return platformCopyTargets(await platformSettings(this.dataSource), await declaredBackupTargets(this.dataSource));
  }

  /** Opens a target with its credentials from the cluster's secrets (overridable for tests). */
  protected async destination(spec: BackupTargetSpec): Promise<CopyDestination> {
    if (spec.type === 's3') {
      const credentials = await this.credentials.providerConfig(spec.credentials);

      return new S3CopyDestination(spec, {
        accessKeyId: credentials['accessKeyId'] ?? '',
        secretAccessKey: credentials['secretAccessKey'] ?? '',
      });
    }

    return new SftpCopyDestination(spec, (await this.credentials.read(spec.keySecret)).toString('utf8'));
  }

  private async pass(now: Date): Promise<PlatformCopyPassResult[]> {
    const settings = await platformSettings(this.dataSource);

    if (!settings.enabled) return [];

    const { targets, missing } = await this.targets();
    const results: PlatformCopyPassResult[] = [];

    for (const name of missing)
      results.push({ target: name, status: 'failed', copied: 0, pruned: 0, error: 'target not declared' });

    if (!targets.length) return results;

    if (!(await this.lease(now))) return results;

    let failed: string | null = null;

    try {
      const source = await this.listSource();

      for (const target of targets) {
        const result = await this.copyTo(target.name, target.spec, source, now);

        results.push(result);

        if (result.status === 'failed') failed = result.error;
      }
    } catch (error) {
      failed = message(error);
      throw error;
    } finally {
      await this.release(failed ? 'failed' : 'succeeded', failed);
    }

    return results;
  }

  /** Every object of the platform bucket with its ETag and size. */
  private async listSource(): Promise<SourceObject[]> {
    const client = await this.store.client();

    try {
      const out: SourceObject[] = [];
      let token: string | undefined;

      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: PLATFORM_BUCKET, ContinuationToken: token }));

        for (const c of page.Contents ?? [])
          if (c.Key) out.push({ key: c.Key, etag: (c.ETag ?? '').replace(/"/g, ''), size: c.Size ?? 0 });

        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);

      return out;
    } finally {
      client.destroy();
    }
  }

  private async copyTo(
    name: string,
    spec: BackupTargetSpec,
    source: SourceObject[],
    now: Date,
  ): Promise<PlatformCopyPassResult> {
    const stateRepo = this.dataSource.getRepository(PlatformCopyTargetEntity);
    const copies = this.dataSource.getRepository(PlatformCopyEntity);
    const started = new Date();

    await stateRepo.save(stateRepo.create({ target: name, lastStartedAt: started }));

    let destination: CopyDestination | null = null;
    let copied = 0;
    let pruned = 0;
    const errors: string[] = [];

    try {
      destination = await this.destination(spec);

      const lockDays = destination instanceof S3CopyDestination ? await destination.objectLockDays() : null;
      const lockUntil = lockDays ? new Date(started.getTime() + lockDays * 86_400_000) : null;
      const { generation, key: dataKey } = await this.keys.current();
      const copyKey = platformCopyKey(dataKey);
      const rows = await copies.find({ where: { target: name } });

      for (const object of objectsToCopy(source, rows)) {
        try {
          const stored = await this.copyObject(destination, object, generation, copyKey, lockUntil);

          await copies.save(
            copies.create({
              target: name,
              key: object.key,
              etag: object.etag,
              size: object.size,
              storedSize: stored,
              generation,
              copiedAt: new Date(),
              lockedUntil: lockUntil,
            }),
          );
          copied++;
        } catch (error) {
          // A WAL segment or snapshot blob that vanished between the listing and the copy (retention) isn't an error.
          if ((error as { name?: string }).name === 'NoSuchKey') continue;

          errors.push(`${object.key}: ${message(error)}`);

          if (errors.length >= 5) break;
        }
      }

      await this.writeDrDescriptions(destination);

      if (!errors.length) pruned = await this.prune(name, destination, source, now);

      const verified = await this.verifyNewestEnvelope(name, destination, source);
      const totals: [{ objects: string; bytes: string }] = await this.dataSource.query(
        `SELECT COUNT(*) AS objects, COALESCE(SUM(stored_size), 0) AS bytes FROM lw_platform_copies WHERE target = $1`,
        [name],
      );

      if (!errors.length) await this.markCatalog(name, started, lockUntil);

      await stateRepo.update(
        { target: name },
        {
          lastFinishedAt: new Date(),
          lastStatus: errors.length ? 'failed' : 'succeeded',
          lastError: errors.length ? errors.join('; ').slice(0, 4000) : null,
          objects: Number(totals[0].objects),
          bytes: Number(totals[0].bytes),
          ...(verified ? { verifiedEnvelope: verified, verifiedAt: new Date() } : {}),
        },
      );

      if (errors.length) this.logger.warn(`External copy to ${name}: ${errors[0]}`);

      return {
        target: name,
        status: errors.length ? 'failed' : 'succeeded',
        copied,
        pruned,
        error: errors[0] ?? null,
      };
    } catch (error) {
      await stateRepo.update(
        { target: name },
        { lastFinishedAt: new Date(), lastStatus: 'failed', lastError: message(error) },
      );
      this.logger.warn(`External copy to ${name}: ${message(error)}`);

      return { target: name, status: 'failed', copied, pruned, error: message(error) };
    } finally {
      await destination?.close().catch(() => undefined);
    }
  }

  /** Streams one object from the bucket through the encryption to the target and checks what arrived. */
  private async copyObject(
    destination: CopyDestination,
    object: SourceObject,
    generation: number,
    copyKey: Buffer,
    lockUntil: Date | null,
  ): Promise<number> {
    const client = await this.store.client();

    try {
      const got = await client.send(new GetObjectCommand({ Bucket: PLATFORM_BUCKET, Key: object.key }));
      const size = got.ContentLength ?? object.size;
      const storedSize = encryptedSize(size);
      const md5 = md5Stream();
      const body = got.Body as Readable;
      const encrypt = encryptStream(copyKey, generation, object.key, size);
      const key = copyKeyOf(object.key);

      // Errors anywhere upstream fail the upload (never a short object on the target).
      body.on('error', (error) => encrypt.destroy(error));
      encrypt.on('error', (error) => md5.destroy(error));
      body.pipe(encrypt).pipe(md5);

      await destination.put(key, md5, storedSize, {
        metadata: { 'lw-generation': String(generation), 'lw-plain-size': String(size) },
        lockUntil,
      });

      const head = await destination.head(key);
      const etag = (head?.etag ?? '').replace(/"/g, '');
      const error = copyVerificationError(
        { storedSize, sha256: md5.digest() },
        head ? { size: head.size, sha256: /^[0-9a-f]{32}$/.test(etag) ? etag : null } : null,
      );

      if (error) throw new Error(error);

      object.size = size;

      return storedSize;
    } finally {
      client.destroy();
    }
  }

  /** Cluster id + active database scope, and the key generations (kit shape, KMS-wrapped roots); no secrets. */
  async drInfo(targets?: Array<{ name: string; spec: BackupTargetSpec }>): Promise<DrInfoDocument> {
    const cluster = await this.dataSource.getRepository(ClusterEntity).findOneOrFail({ where: {} });
    const keyRows = await this.dataSource.getRepository(BackupKeyEntity).find({ order: { generation: 'DESC' } });
    const keys: DrInfoKey[] = keyRows.map((k) => ({
      generation: k.generation,
      rootId: k.rootId,
      kitShares: k.kitShares,
      kitThreshold: k.kitThreshold,
      kitConfirmed: !!k.kitConfirmedAt,
      active: k.active,
      escrow: k.escrow ? { provider: k.escrow.provider, keyRef: k.escrow.keyRef, wrapped: k.escrow.wrapped } : null,
    }));

    return {
      format: DR_INFO_FORMAT,
      version: 1,
      clusterId: cluster.clusterId,
      postgresScope: await activePostgresScope(this.dataSource, cluster.clusterId),
      createdAt: new Date().toISOString(),
      targets: (targets ?? (await this.targets()).targets).map((t) => drInfoTarget(t.name, t.spec)),
      keys,
    };
  }

  private async writeDrDescriptions(destination: CopyDestination): Promise<void> {
    const info = await this.drInfo([]);
    const docs: Array<[string, unknown]> = [
      [DR_CLUSTER_KEY, { clusterId: info.clusterId, postgresScope: info.postgresScope, updatedAt: info.createdAt }],
      [DR_KEYS_KEY, { keys: info.keys, updatedAt: info.createdAt }],
    ];

    for (const [key, doc] of docs) {
      const body = Buffer.from(JSON.stringify(doc, null, 2));

      await destination.put(key, Readable.from([body]), body.length, { metadata: { 'lw-kind': 'dr-description' } });
    }
  }

  /** Reads the newest DR envelope back from the target and opens it with the backup key (proves key + copy). */
  private async verifyNewestEnvelope(
    name: string,
    destination: CopyDestination,
    source: SourceObject[],
  ): Promise<string | null> {
    const envelopes = source.filter((o) => o.key.startsWith('dr-envelope/')).map((o) => o.key);
    const copied = new Set(
      (
        await this.dataSource
          .getRepository(PlatformCopyEntity)
          .find({ where: { target: name, key: In(envelopes.length ? envelopes : ['-']) } })
      ).map((c) => c.key),
    );
    // Newest by catalog time: envelope names are backup names, not times.
    const rows = await this.dataSource.getRepository(BackupEntity).find({
      where: { resource: In(PLATFORM_BACKUP_KINDS.map(platformResource)), status: 'succeeded', deletedAt: IsNull() },
      order: { startedAt: 'DESC' },
      take: 50,
    });
    const newest = rows.map((r) => `dr-envelope/${r.snapshotId}.json`).find((k) => copied.has(k));

    if (!newest) return null;

    const chunks: Buffer[] = [];
    const keyCache = new Map<number, Buffer>();

    for (const row of await this.dataSource
      .getRepository(PlatformCopyEntity)
      .find({ where: { target: name, key: newest } }))
      keyCache.set(row.generation, platformCopyKey(await this.keys.forGeneration(row.generation)));

    await pipeline(
      await destination.get(copyKeyOf(newest)),
      decryptStream(newest, (g) => {
        const key = keyCache.get(g);

        if (!key) throw new Error(`no key for generation ${g}`);

        return key;
      }),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );

    const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as DrEnvelope;

    await openDrEnvelope(envelope, this.keys);

    return newest;
  }

  /** Catalog rows of platform backups now held by the target (for the catalog's immutability / target columns). */
  private async markCatalog(target: string, passStarted: Date, lockedUntil: Date | null): Promise<void> {
    const rows = await this.dataSource.getRepository(BackupEntity).find({
      where: {
        resource: In(PLATFORM_BACKUP_KINDS.map(platformResource)),
        status: 'succeeded',
        deletedAt: IsNull(),
        finishedAt: LessThanOrEqual(passStarted),
      },
    });
    const copiedAt = new Date().toISOString();

    for (const row of rows.filter((r) => !r.targets.some((t) => t.target === target)))
      await this.dataSource.getRepository(BackupEntity).update(
        { id: row.id },
        {
          targets: [...row.targets, { target, copiedAt, lockedUntil: lockedUntil?.toISOString() ?? null }],
        },
      );
  }

  /**
   * Objects retention removed from the bucket are removed from the target too, once their object lock ended. Only
   * after a complete listing with no copy errors; refused deletes (append-only credentials, locks) keep them.
   */
  private async prune(name: string, destination: CopyDestination, source: SourceObject[], now: Date): Promise<number> {
    if (!source.length) return 0;

    const present = new Set(source.map((o) => o.key));
    const gone = (await this.dataSource.getRepository(PlatformCopyEntity).find({ where: { target: name } })).filter(
      (c) => !present.has(c.key) && (!c.lockedUntil || c.lockedUntil.getTime() <= now.getTime()),
    );

    if (!gone.length) return 0;

    try {
      await destination.delete(gone.map((c) => copyKeyOf(c.key)));
    } catch (error) {
      this.logger.warn(`External copy ${name}: pruning refused (${message(error)}); objects kept`);

      return 0;
    }

    for (let i = 0; i < gone.length; i += 500)
      await this.dataSource
        .getRepository(PlatformCopyEntity)
        .delete({ target: name, key: In(gone.slice(i, i + 500).map((c) => c.key)) });

    return gone.length;
  }

  async status(): Promise<PlatformCopyTargetDto[]> {
    const { targets, missing } = await this.targets();
    const states = new Map(
      (await this.dataSource.getRepository(PlatformCopyTargetEntity).find()).map((s) => [s.target, s]),
    );
    const dto = (name: string, spec: BackupTargetSpec | null): PlatformCopyTargetDto => {
      const s = states.get(name);

      return {
        target: name,
        type: spec?.type ?? null,
        declared: !!spec,
        objectLock: spec?.type === 's3' && spec.objectLock ? spec.objectLock : null,
        lastStartedAt: s?.lastStartedAt?.toISOString() ?? null,
        lastFinishedAt: s?.lastFinishedAt?.toISOString() ?? null,
        lastStatus: s?.lastStatus ?? null,
        lastError: s?.lastError ?? null,
        objects: s?.objects ?? 0,
        bytes: s?.bytes ?? 0,
        verifiedEnvelope: s?.verifiedEnvelope ?? null,
        verifiedAt: s?.verifiedAt?.toISOString() ?? null,
      };
    };

    return [...targets.map((t) => dto(t.name, t.spec)), ...missing.map((m) => dto(m, null))];
  }
}
