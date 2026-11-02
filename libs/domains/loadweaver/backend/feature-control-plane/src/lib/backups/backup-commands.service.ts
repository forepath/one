import {
  backupChannel,
  controlPlaneMessage,
  messageAllowed,
  type BackupHooks,
  type BackupProgress,
  type RestoreCheck,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { getQueueRole, shouldRunApiHttp } from '@forepath/shared/backend';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';

import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { BackupEntity, RestoreEntity, RestoreTestEntity } from './backup.entities';
import { BackupRepositoriesService } from './backup-repositories.service';
import { writesPaused } from '../database-handover/database-target.runtime';

const DISPATCH_MS = 10_000;
/** A command without progress is sent again after this long (the agent re-reports idempotently). */
const RESEND_MS = 60_000;
/** Running operations without a final report fail after this long. */
export const OPERATION_TIMEOUT_MS = 12 * 3_600_000;

export interface BackupCommandSpec {
  description: string;
  tags: Record<string, string>;
  hooks?: BackupHooks;
}

export interface RestoreCommandSpec {
  mode?: 'replace' | 'merge';
  path?: string;
  targetPath?: string;
  overwrite?: boolean;
}

export interface RestoreTestCommandSpec {
  sizeBytes: number;
  check?: RestoreCheck;
}

/**
 * Node commands of backups, restores and restore tests (3.20), derived from their rows on every control-plane
 * replica and sent to the nodes connected here (only to nodes that advertise `backups`). Credentials (the volume's
 * Kopia user) are added when a command is sent and never stored. Progress comes back on the command's channel and
 * is accepted only from the node the row names.
 */
@Injectable()
export class BackupCommandsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BackupCommandsService.name);
  private readonly sent = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private sending = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: AgentSessionRegistry,
    private readonly repositories: BackupRepositoriesService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env['LOADWEAVER_BACKUPS'] ?? 'on') === 'off' || !shouldRunApiHttp(getQueueRole())) return;

    this.timer = setInterval(() => {
      if (writesPaused('Backup commands', this.logger)) return;

      void this.sendDue().catch((error: unknown) =>
        this.logger.warn(`Backup commands: ${error instanceof Error ? error.message : String(error)}`),
      );
    }, DISPATCH_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Sends due commands to locally connected nodes; returns how many were sent. */
  async sendDue(now = Date.now()): Promise<number> {
    if (this.sending) return 0;

    this.sending = true;

    try {
      let count = 0;
      const live = new Set<string>();
      const send = async (
        id: string,
        node: string | null,
        build: () => Promise<Parameters<typeof controlPlaneMessage>>,
      ) => {
        live.add(id);

        const session = node ? this.registry.get(node) : undefined;

        if (!session || now - (this.sent.get(id) ?? 0) < RESEND_MS) return;

        const [type, payload] = await build();

        if (!messageAllowed(type, session.protocol)) return;

        session.send(controlPlaneMessage(type, payload as never, { channel: backupChannel(id) }));
        this.sent.set(id, now);
        count++;
      };

      for (const row of await this.dataSource.getRepository(BackupEntity).find({ where: { status: 'running' } })) {
        if (this.timedOut(row.startedAt, now)) {
          await this.finishBackup(row.id, { status: 'failed', error: 'timed out without a report from the node' });
          continue;
        }

        await send(row.id, row.node, async () => {
          const spec = (row.command ?? {}) as Partial<BackupCommandSpec>;

          return [
            'backupRun',
            {
              backup: row.id,
              volume: row.resource,
              repository: await this.repositories.volumeAccess(row.scope, row.resource),
              description: spec.description ?? '',
              tags: spec.tags ?? {},
              ...(spec.hooks ? { hooks: spec.hooks } : {}),
            },
          ];
        }).catch((error: unknown) => this.logger.warn(`Backup ${row.id}: ${String(error)}`));
      }

      const restores = await this.dataSource.getRepository(RestoreEntity).find({ where: { status: 'running' } });
      const tests = await this.dataSource.getRepository(RestoreTestEntity).find({ where: { status: 'running' } });
      const sources = new Map(
        (
          await this.dataSource.getRepository(BackupEntity).find({
            where: { id: In([...restores.map((r) => r.backupId), ...tests.map((t) => t.backupId)]) },
          })
        ).map((b) => [b.id, b]),
      );

      for (const row of restores) {
        const backup = sources.get(row.backupId);

        if (!backup?.rootObject || backup.deletedAt || this.timedOut(row.startedAt ?? new Date(now), now)) {
          await this.finishRestore(row.id, {
            status: 'failed',
            error: backup?.rootObject && !backup.deletedAt ? 'timed out' : 'the backup is gone',
          });
          continue;
        }

        await send(row.id, row.node, async () => {
          const spec = (row.command ?? {}) as RestoreCommandSpec;

          return [
            'restoreRun',
            {
              restore: row.id,
              kind: row.kind,
              snapshot: backup.rootObject as string,
              repository: await this.repositories.volumeAccess(backup.scope, backup.resource),
              volume: row.volume,
              ...(spec.mode ? { mode: spec.mode } : {}),
              ...(spec.path ? { path: spec.path } : {}),
              ...(spec.targetPath ? { targetPath: spec.targetPath } : {}),
              ...(spec.overwrite !== undefined ? { overwrite: spec.overwrite } : {}),
            },
          ];
        }).catch((error: unknown) => this.logger.warn(`Restore ${row.id}: ${String(error)}`));
      }

      for (const row of tests) {
        const backup = sources.get(row.backupId);

        if (!backup?.rootObject || this.timedOut(row.startedAt, now)) {
          await this.finishTest(row.id, {
            status: 'failed',
            error: backup?.rootObject ? 'timed out' : 'the backup is gone',
          });
          continue;
        }

        await send(row.id, row.node, async () => {
          const spec = (row.command ?? {}) as Partial<RestoreTestCommandSpec>;

          return [
            'restoreRun',
            {
              restore: row.id,
              kind: 'scratch',
              snapshot: backup.rootObject as string,
              repository: await this.repositories.volumeAccess(backup.scope, backup.resource),
              volume: backup.resource,
              sizeBytes: spec.sizeBytes ?? 1024 ** 3,
              ...(spec.check ? { check: spec.check } : {}),
            },
          ];
        }).catch((error: unknown) => this.logger.warn(`Restore test ${row.id}: ${String(error)}`));
      }

      for (const key of this.sent.keys()) if (!live.has(key)) this.sent.delete(key);

      return count;
    } finally {
      this.sending = false;
    }
  }

  private timedOut(startedAt: Date, now: number): boolean {
    return now - startedAt.getTime() > OPERATION_TIMEOUT_MS;
  }

  /**
   * Progress of a backup / restore / restore test from a node: only on the operation's channel and only from the
   * node the operation runs on. Returns whether it was accepted.
   */
  async recordProgress(nodeName: string, progress: BackupProgress, channel: string | undefined): Promise<boolean> {
    if (channel !== backupChannel(progress.id)) return false;

    // Any report counts as "heard of it": no re-send while it runs.
    this.sent.set(progress.id, Date.now());

    if (progress.operation === 'backup') {
      const row = await this.dataSource
        .getRepository(BackupEntity)
        .findOne({ where: { id: progress.id, status: 'running' } });

      if (!row || row.node !== nodeName) return false;

      if (progress.status === 'running') return true;

      if (progress.status === 'failed') {
        await this.finishBackup(row.id, { status: 'failed', error: progress.error ?? 'failed on the node' });

        return true;
      }

      if (!progress.snapshot) {
        await this.finishBackup(row.id, { status: 'failed', error: 'the node reported no snapshot' });

        return true;
      }

      await this.finishBackup(row.id, {
        status: 'succeeded',
        snapshotId: progress.snapshot.manifestId,
        rootObject: progress.snapshot.rootObject,
        bytes: progress.bytes ?? 0,
        // Kopia 0.23's `snapshot create --json` has no upload stats: count the logical size until it does.
        uploadedBytes: progress.uploadedBytes ?? progress.bytes ?? 0,
        files: progress.files ?? 0,
        hooks: progress.hooks ?? false,
        targets: [{ target: 'garage', copiedAt: progress.snapshot.endTime, lockedUntil: null }],
      });

      return true;
    }

    const restore = await this.dataSource
      .getRepository(RestoreEntity)
      .findOne({ where: { id: progress.id, status: 'running' } });

    if (restore) {
      if (restore.node !== nodeName) return false;

      if (progress.status === 'running')
        await this.dataSource.getRepository(RestoreEntity).update(
          { id: restore.id },
          {
            progress: {
              ...(progress.phase ? { phase: progress.phase } : {}),
              ...(progress.bytes !== undefined ? { bytes: progress.bytes } : {}),
              ...(progress.files !== undefined ? { files: progress.files } : {}),
            },
          },
        );
      else
        await this.finishRestore(restore.id, {
          status: progress.status === 'done' ? 'done' : 'failed',
          error: progress.status === 'failed' ? (progress.error ?? 'failed on the node') : null,
        });

      return true;
    }

    const test = await this.dataSource
      .getRepository(RestoreTestEntity)
      .findOne({ where: { id: progress.id, status: 'running' } });

    if (!test || test.node !== nodeName) return false;

    if (progress.status === 'running') return true;

    const checkFailed = !!progress.check && progress.check.exitCode !== 0;

    await this.finishTest(test.id, {
      status: progress.status === 'done' && !checkFailed ? 'passed' : 'failed',
      check: progress.check
        ? {
            command: ((test.command as Partial<RestoreTestCommandSpec> | null)?.check?.command as string[]) ?? null,
            exitCode: progress.check.exitCode,
            output: progress.check.output,
          }
        : null,
      error:
        progress.status === 'failed'
          ? (progress.error ?? 'failed on the node')
          : checkFailed
            ? `check hook exited with ${progress.check?.exitCode ?? 'no exit code'}`
            : null,
    });

    return true;
  }

  private async finishBackup(id: string, values: Partial<BackupEntity>): Promise<void> {
    await this.dataSource
      .getRepository(BackupEntity)
      .update({ id, status: 'running' }, { ...values, finishedAt: new Date() });
  }

  private async finishRestore(id: string, values: Partial<RestoreEntity>): Promise<void> {
    await this.dataSource
      .getRepository(RestoreEntity)
      .update({ id, status: 'running' }, { ...values, finishedAt: new Date() });
  }

  private async finishTest(id: string, values: Partial<RestoreTestEntity>): Promise<void> {
    await this.dataSource
      .getRepository(RestoreTestEntity)
      .update({ id, status: 'running' }, { ...values, finishedAt: new Date() });
  }
}
