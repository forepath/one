import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { RequestWithUser } from '@forepath/identity/backend';
import { projectBackupScope } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as tar from 'tar';
import { DataSource } from 'typeorm';

import { atLeast, projectRole } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';
import { BackupEntity } from './backup.entities';
import { BackupRepositoriesService } from './backup-repositories.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupsService, type BackupDto } from './backups.service';

/** Default cap of an archive in either direction (50 GiB); `LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES` overrides it. */
export const DEFAULT_BACKUP_ARCHIVE_MAX_BYTES = 50 * 1024 ** 3;

const VOLUME_ID = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/;
const SOURCE_LABEL = /^[A-Za-z0-9._:-]{1,128}$/;

export function backupArchiveMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES']);

  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_BACKUP_ARCHIVE_MAX_BYTES;
}

/** Passes at most `max` bytes, then fails the pipeline with 413 (the caller's stream is not trusted). */
export function byteLimit(max: number): Transform & { bytes: () => number } {
  let seen = 0;
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;

      if (seen > max) callback(new PayloadTooLargeException(`archive larger than ${max} bytes`));
      else callback(null, chunk);
    },
  }) as Transform & { bytes: () => number };

  transform.bytes = () => seen;

  return transform;
}

/**
 * Where archives are staged on the control plane (export: the tar kopia writes; import: the upload and the extracted
 * tree): `LOADWEAVER_BACKUP_STAGING_DIR`, else the OS temp dir. Recommended: a dedicated filesystem / volume with a
 * quota of at least twice `LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES` (an import holds the upload and the extracted tree
 * until the upload is removed), so a large import can't fill the control plane's root disk.
 */
export function backupStagingDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_BACKUP_STAGING_DIR']?.trim() || tmpdir();
}

async function stagingTemp(prefix: string): Promise<string> {
  const root = backupStagingDir();

  await mkdir(root, { recursive: true, mode: 0o700 });

  return await mkdtemp(join(root, prefix));
}

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Imports accept plain (uncompressed) ustar archives only — POSIX / PAX (`ustar\0`) or GNU (`ustar  `) headers, as
 * kopia's tar export writes them. Compressed input is refused up front: `tar` would otherwise decompress gzip / zstd
 * transparently and the size cap would count compressed bytes (decompression bomb). Null = acceptable.
 */
export function plainTarIssue(firstBlock: Buffer): string | null {
  if (firstBlock.subarray(0, 2).equals(GZIP_MAGIC) || firstBlock.subarray(0, 4).equals(ZSTD_MAGIC))
    return 'compressed archives are not accepted; send an uncompressed (ustar) tar';

  if (firstBlock.length < 512 || firstBlock.subarray(257, 262).toString('latin1') !== 'ustar')
    return 'only uncompressed ustar tar archives are accepted';

  return null;
}

/** File modes as extracted: permission bits only (setuid / setgid / sticky are stripped). */
export function safeArchiveMode(mode: number): number {
  return mode & 0o777;
}

/**
 * Archive entries accepted on import: files, directories and symbolic links only (no devices, FIFOs or hard links);
 * absolute paths and `..` are already refused by `tar` itself (`preservePaths` stays off).
 */
export function acceptedArchiveEntry(path: string, type: string | undefined): boolean {
  if (path.split('/').some((segment) => segment === '..')) return false;

  return (
    type === 'File' ||
    type === 'OldFile' ||
    type === 'ContiguousFile' ||
    type === 'Directory' ||
    type === 'SymbolicLink'
  );
}

async function firstBlock(file: string): Promise<Buffer> {
  const handle = await open(file, 'r');

  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, 512, 0);

    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export interface BackupArchive {
  stream: Readable;
  bytes: number;
  filename: string;
}

/**
 * Whole-backup transfer between clusters (3.20 "cross-cluster restore & cloning via fleet", 3.24): the source
 * cluster exports a backup as a tar archive (decrypted by its own control plane, streamed over TLS), the target
 * cluster imports it as a new catalog entry under its own backup key; the restore itself is then a normal `Restore`
 * resource through plan / apply (approvals apply). Both directions need an operator of the project and dedicated
 * PAT scopes (`backups:export` / `backups:import`), and both are audited. "Back up everything now" (cluster admins)
 * is the final backup a fleet runs before a Loadweaver Cloud teardown.
 */
@Injectable()
export class BackupTransferService {
  private readonly logger = new Logger(BackupTransferService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly repositories: BackupRepositoriesService,
    private readonly scheduler: BackupSchedulerService,
    private readonly backups: BackupsService,
    private readonly audit: AuditLogService,
  ) {}

  private async assertOperator(req: RequestWithUser | undefined, project: string, what: string): Promise<void> {
    const caller = await this.access.caller(req);

    if (!atLeast(projectRole(caller, project), 'operator')) throw new ForbiddenException(`operators ${what}`);
  }

  /** The whole backup as a tar archive (a temporary file, removed when the stream ends). */
  async exportArchive(req: RequestWithUser | undefined, id: string): Promise<BackupArchive> {
    const row = await this.dataSource.getRepository(BackupEntity).findOne({ where: { id } });

    // Project backups only: cluster-scoped data never leaves the cluster this way.
    if (!row || !row.project) throw new NotFoundException('backup not found');

    await this.assertOperator(req, row.project, 'export backups');

    if (row.status !== 'succeeded' || !row.rootObject || row.deletedAt)
      throw new BadRequestException('the backup is not available');

    const max = backupArchiveMaxBytes();

    if (row.bytes > max) throw new PayloadTooLargeException(`backup larger than ${max} bytes`);

    const dir = await stagingTemp('lw-export-');
    const file = join(dir, 'backup.tar');

    try {
      await this.repositories.cli.restoreArchive(
        await this.repositories.controlConnection(row.scope),
        row.rootObject,
        file,
      );
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }

    const { size } = await stat(file);

    await this.dataSource.transaction(async (manager) => {
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'backup.exported',
        target: `backup/${row.id}`,
        project: row.project,
        details: { resource: row.resource, bytes: size },
      });
    });

    const stream = createReadStream(file);
    const cleanup = () => void rm(dir, { recursive: true, force: true });

    stream.on('close', cleanup);
    stream.on('error', cleanup);

    return { stream, bytes: size, filename: `${row.resource.replace(/[^a-z0-9_.-]/gi, '_')}-${row.id}.tar` };
  }

  /**
   * Imports a tar archive into the catalog of the target volume's project (a new backup with `policy: null`, so no
   * retention ever removes it; deletion requests apply as usual). The volume must exist: restore into it with a
   * `Restore` resource afterwards.
   */
  async importArchive(
    req: RequestWithUser | undefined,
    input: { volume: string; sourceCluster?: string; sourceBackup?: string },
    body: Readable,
  ): Promise<BackupDto> {
    if (!VOLUME_ID.test(input.volume)) throw new BadRequestException('volume is <project>/<deployment>/<volume>');

    for (const label of [input.sourceCluster, input.sourceBackup])
      if (label !== undefined && !SOURCE_LABEL.test(label)) throw new BadRequestException('invalid source label');

    const [project] = input.volume.split('/');

    await this.assertOperator(req, project, 'import backups');

    if (!(await this.dataSource.getRepository(VolumePlacementEntity).exists({ where: { id: input.volume } })))
      throw new NotFoundException('volume not found');

    const running = await this.dataSource
      .getRepository(BackupEntity)
      .exists({ where: { resource: input.volume, status: 'running' } });

    if (running) throw new ConflictException('a backup of this volume is running');

    const dir = await stagingTemp('lw-import-');
    const archive = join(dir, 'upload.tar');
    const tree = join(dir, 'data');
    const startedAt = new Date();

    try {
      const max = backupArchiveMaxBytes();
      const limit = byteLimit(max);

      await pipeline(body, limit, createWriteStream(archive, { mode: 0o600 }));

      if (limit.bytes() === 0) throw new BadRequestException('empty archive');

      const issue = plainTarIssue(await firstBlock(archive));

      if (issue) throw new BadRequestException(`invalid tar archive: ${issue}`);

      await mkdir(tree, { mode: 0o700 });

      // Running total of the declared entry sizes: the extracted tree never exceeds the cap either.
      let extractedBytes = 0;
      let tooLarge = false;

      try {
        await tar.x({
          file: archive,
          cwd: tree,
          strict: true,
          preserveOwner: false,
          zstd: false,
          brotli: false,
          filter: (path, entry) => {
            const e = entry as { type?: string; size?: number; mode?: number };

            if (tooLarge || !acceptedArchiveEntry(path, e.type)) return false;

            extractedBytes += typeof e.size === 'number' && e.size > 0 ? e.size : 0;

            if (extractedBytes > max) {
              tooLarge = true;

              return false;
            }

            if (typeof e.mode === 'number') e.mode = safeArchiveMode(e.mode);

            return true;
          },
        });
      } catch (error) {
        // A declared size beyond the cap wins over the parse error a truncated body causes afterwards.
        if (tooLarge) throw new PayloadTooLargeException(`archive contents larger than ${max} bytes`);

        throw new BadRequestException(`invalid tar archive: ${error instanceof Error ? error.message : error}`);
      }

      if (tooLarge) throw new PayloadTooLargeException(`archive contents larger than ${max} bytes`);

      await rm(archive, { force: true });

      const scope = projectBackupScope(project);
      const repository = await this.repositories.ensure(scope);
      const snapshot = await this.repositories.cli.snapshotDirectory(
        await this.repositories.controlConnection(scope),
        tree,
        `import ${input.sourceCluster ?? 'archive'}`,
        {
          import: 'fleet',
          volume: input.volume.split('/')[2],
          ...(input.sourceBackup ? { source: input.sourceBackup } : {}),
        },
      );
      const repo = this.dataSource.getRepository(BackupEntity);
      const row = await this.dataSource.transaction(async (manager) => {
        const saved = await manager.getRepository(BackupEntity).save(
          repo.create({
            scope,
            project,
            resource: input.volume,
            policy: null,
            node: null,
            status: 'succeeded',
            snapshotId: snapshot.id,
            rootObject: snapshot.rootEntry.obj,
            keyGeneration: repository.keyGeneration,
            bytes: snapshot.rootEntry.summ?.size ?? snapshot.stats?.totalSize ?? 0,
            uploadedBytes: 0,
            files: snapshot.rootEntry.summ?.files ?? snapshot.stats?.fileCount ?? 0,
            targets: [{ target: 'garage', copiedAt: new Date().toISOString(), lockedUntil: null }],
            keep: [],
            hooks: false,
            command: {
              description: 'import',
              source: { cluster: input.sourceCluster ?? null, backup: input.sourceBackup ?? null },
            },
            error: null,
            startedAt,
            finishedAt: new Date(),
            deletedAt: null,
          }),
        );

        await this.audit.record(manager, {
          actor: actorFromRequest(req),
          action: 'backup.imported',
          target: `backup/${saved.id}`,
          project,
          details: {
            resource: input.volume,
            bytes: saved.bytes,
            sourceCluster: input.sourceCluster ?? null,
            sourceBackup: input.sourceBackup ?? null,
          },
        });

        return saved;
      });

      return await this.backups.get(req, row.id);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch((error: unknown) =>
        this.logger.warn(`Removing ${dir}: ${error instanceof Error ? error.message : error}`),
      );
    }
  }

  /**
   * "Back up everything now" (cluster admins): one backup per placed volume that has none running, e.g. the final
   * backup before a Loadweaver Cloud teardown (3.24 / section 4). Secondary copies to external targets follow
   * automatically after each backup; platform backups are separate (`backups/platform/:kind/run`).
   */
  async backupAll(req: RequestWithUser | undefined): Promise<{ started: string[]; skipped: string[] }> {
    const caller = await this.access.caller(req);

    if (caller.clusterRole !== 'cluster-admin') throw new ForbiddenException('cluster admins back up everything');

    const placements = await this.dataSource.getRepository(VolumePlacementEntity).find({ order: { id: 'ASC' } });
    const running = new Set(
      (await this.dataSource.getRepository(BackupEntity).find({ where: { status: 'running' } })).map((b) => b.resource),
    );
    const started: string[] = [];
    const skipped: string[] = [];

    for (const placement of placements) {
      const [project, deployment, volume] = placement.id.split('/');

      if (!project || !deployment || !volume || running.has(placement.id)) {
        skipped.push(placement.id);
        continue;
      }

      const deploymentRow = await this.dataSource
        .getRepository(ResourceEntity)
        .findOne({ where: { kind: 'Deployment', project, name: deployment } });

      try {
        await this.scheduler.startBackup(
          { id: placement.id, project, deployment, volume, deploymentLabels: deploymentRow?.labels ?? {} },
          { key: null, hooks: true },
        );
        started.push(placement.id);
      } catch (error) {
        this.logger.warn(`Backup of ${placement.id}: ${error instanceof Error ? error.message : error}`);
        skipped.push(placement.id);
      }
    }

    await this.audit.recordStandalone({
      actor: actorFromRequest(req),
      action: 'backup.all-started',
      target: 'cluster/backups',
      details: { started: started.length, skipped },
    });

    return { started, skipped };
  }
}
