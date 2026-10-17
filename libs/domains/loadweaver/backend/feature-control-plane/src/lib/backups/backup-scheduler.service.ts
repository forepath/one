import { GetObjectLockConfigurationCommand, S3Client } from '@aws-sdk/client-s3';
import { projectBackupScope, type RestoreCheck } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  backupPolicySpecSchema,
  backupRetentionSchema,
  backupTargetSpecSchema,
  restoreSpecSchema,
  type BackupPolicySpec,
  type BackupRetention,
  type BackupTargetSpec,
} from '@forepath/loadweaver/shared/util-model';
import { getQueueRole, shouldRunApiHttp } from '@forepath/shared/backend';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan } from 'typeorm';

import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { GitLeases } from '../git/git-locks';
import { objectStorePorts } from '../object-store/object-store.utils';
import { AuditLogService } from '../services/audit-log.service';
import { ObjectStoreControllerService, nodeAddress } from '../services/object-store-controller.service';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import { WorkloadPlannerService } from '../services/workload-planner.service';
import type { ParsedDeployment } from '../utils/workload-planning.utils';
import {
  BackupDeletionEntity,
  BackupEntity,
  BackupRetentionEntity,
  RestoreEntity,
  RestoreTestEntity,
} from './backup.entities';
import type { BackupCommandSpec, RestoreCommandSpec, RestoreTestCommandSpec } from './backup-commands.service';
import { BackupRepositoriesService } from './backup-repositories.service';
import { PlatformBackupsService } from './platform/platform-backups.service';
import {
  applyRetention,
  deletionDelayMs,
  deletionDue,
  latestScheduled,
  policyVolumes,
  retentionMax,
  retentionShorter,
  sameRetention,
  volumeDue,
  type VolumeCandidate,
} from './backup.utils';

const TICK_MS = 30_000;
const LEASE_KEY = 'backups:scheduler';

export function policyKey(project: string | null, name: string): string {
  return `${project ?? 'cluster'}/${name}`;
}

export interface TargetStatus {
  target: string;
  scope: string;
  at: string;
  ok: boolean;
  error?: string;
}

interface Inventory {
  resources: ResourceEntity[];
  parsed: ParsedDeployment[];
  placements: VolumePlacementEntity[];
  volumes: VolumeCandidate[];
}

/**
 * The backup controller (3.20), on the replica holding the lease: starts scheduled backups of the volumes each
 * `BackupPolicy` selects, applies retention (shortening only after a second admin's approval and the delay),
 * executes approved deletions, starts restore tests and `Restore` resources, and copies repositories to external
 * targets. Node work goes through `BackupCommandsService`; Kopia work runs as the control plane's user.
 */
@Injectable()
export class BackupSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BackupSchedulerService.name);
  private readonly leases: GitLeases;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Last secondary-copy result per target and scope (for the catalog and alerts). */
  readonly targetStatus = new Map<string, TargetStatus>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly planner: WorkloadPlannerService,
    private readonly repositories: BackupRepositoriesService,
    private readonly audit: AuditLogService,
    private readonly objectStore: ObjectStoreControllerService,
    private readonly credentials: PlatformCredentialsService,
    @Optional() private readonly platform?: PlatformBackupsService,
  ) {
    this.leases = new GitLeases(dataSource);
  }

  onApplicationBootstrap(): void {
    if ((process.env['LOADWEAVER_BACKUPS'] ?? 'on') === 'off' || !shouldRunApiHttp(getQueueRole())) return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;

    this.running = true;

    try {
      await this.leases.ifFree(LEASE_KEY, async () => await this.tick());
    } catch (error) {
      this.logger.warn(`Backups: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** One pass; every part is guarded so one failing policy / target doesn't stop the others. */
  async tick(now = new Date()): Promise<void> {
    const inventory = await this.inventory();
    const guard = async (what: string, fn: () => Promise<void>) =>
      await fn().catch((error: unknown) =>
        this.logger.warn(`Backups ${what}: ${error instanceof Error ? error.message : String(error)}`),
      );

    for (const policy of inventory.resources.filter((r) => r.kind === 'BackupPolicy')) {
      const spec = backupPolicySpecSchema.parse(policy.spec);
      const key = policyKey(policy.project, policy.name);
      const volumes = policyVolumes({ project: policy.project, spec }, inventory.volumes);

      await guard(`policy ${key}`, async () => {
        const retention = await this.effectiveRetention(key, spec.retention, policy.updatedBy, now);

        await this.schedule(key, spec, volumes, inventory, now);
        await this.retain(key, spec, retention, volumes);
        await this.restoreTests(key, spec, volumes, inventory, now);
      });
    }

    await guard('restores', async () => await this.restores(inventory, now));
    await guard('deletions', async () => await this.executeDeletions(now));
    await guard('targets', async () => await this.secondaryCopies(inventory, now));
  }

  private async inventory(): Promise<Inventory> {
    const resources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: { kind: In(['Project', 'Deployment', 'BackupPolicy', 'BackupTarget', 'Restore']) } });
    const placements = await this.dataSource.getRepository(VolumePlacementEntity).find();
    const labels = new Map(
      resources.filter((r) => r.kind === 'Deployment').map((r) => [`${r.project}/${r.name}`, r.labels ?? {}]),
    );
    const volumes = placements.map((p) => {
      const [project, deployment, volume] = p.id.split('/');

      return { id: p.id, project, deployment, volume, deploymentLabels: labels.get(`${project}/${deployment}`) ?? {} };
    });

    return { resources, parsed: this.planner.parse(resources).parsed, placements, volumes };
  }

  // ------------------------------------------------------------------------------------------------ schedules

  private async schedule(
    key: string,
    spec: BackupPolicySpec,
    volumes: VolumeCandidate[],
    inventory: Inventory,
    now: Date,
  ): Promise<void> {
    const latest = latestScheduled(spec, now);

    if (!latest) return;

    for (const volume of volumes) {
      const last = await this.dataSource
        .getRepository(BackupEntity)
        .findOne({ where: { resource: volume.id, policy: key }, order: { startedAt: 'DESC' } });

      if (last?.status === 'running' || !volumeDue(latest, last?.startedAt ?? null)) continue;

      await this.startBackup(volume, { key, hooks: spec.hooks }, inventory, now);
    }
  }

  /** Starts a backup of a volume on the node holding its primary (also "back up now"). */
  async startBackup(
    volume: VolumeCandidate,
    policy: { key: string | null; hooks: boolean },
    inventory?: Inventory,
    now = new Date(),
  ): Promise<BackupEntity> {
    const inv = inventory ?? (await this.inventory());
    const placement = inv.placements.find((p) => p.id === volume.id);

    if (!placement) throw new Error(`volume ${volume.id} is not placed`);

    const scope = projectBackupScope(volume.project);
    const repository = await this.repositories.ensure(scope);
    const hooks = policy.hooks ? this.hooksFor(volume, placement.primaryNode, inv) : undefined;
    const command: BackupCommandSpec = {
      description: policy.key ? `policy ${policy.key}` : 'manual',
      tags: { ...(policy.key ? { policy: policy.key.replace(/[^a-z0-9_.-]/g, '_') } : {}), volume: volume.volume },
      ...(hooks ? { hooks: await hooks } : {}),
    };

    if (!command.hooks) delete command.hooks;

    const repo = this.dataSource.getRepository(BackupEntity);

    return await repo.save(
      repo.create({
        scope,
        project: volume.project,
        resource: volume.id,
        policy: policy.key,
        node: placement.primaryNode,
        status: 'running',
        snapshotId: null,
        rootObject: null,
        keyGeneration: repository.keyGeneration,
        bytes: 0,
        uploadedBytes: 0,
        files: 0,
        targets: [],
        keep: [],
        hooks: false,
        command: command as unknown as Record<string, unknown>,
        error: null,
        startedAt: now,
        finishedAt: null,
        deletedAt: null,
      }),
    );
  }

  /** `x-loadweaver.backup.hooks` of a service mounting the volume, run in its replica on the primary's node. */
  private async hooksFor(volume: VolumeCandidate, node: string, inventory: Inventory) {
    const deployment = inventory.parsed.find((d) => d.project === volume.project && d.name === volume.deployment);
    const service = deployment?.compose.services.find(
      (s) =>
        (s.backup?.pre || s.backup?.post) && s.volumes.some((m) => m.type === 'volume' && m.source === volume.volume),
    );

    if (!service?.backup) return undefined;

    const replica = await this.dataSource.getRepository(WorkloadPlacementEntity).findOne({
      where: { project: volume.project, deployment: volume.deployment, service: service.name, node },
      order: { id: 'ASC' },
    });

    if (!replica) return undefined;

    return {
      replica: replica.id,
      ...(service.backup.pre ? { pre: service.backup.pre } : {}),
      ...(service.backup.post ? { post: service.backup.post } : {}),
      timeoutSeconds: service.backup.timeoutSeconds,
    };
  }

  // ------------------------------------------------------------------------------------------------ retention

  /**
   * The retention a policy runs with: a longer one applies at once; a shorter one keeps the previous (longer) rules
   * and opens a request that needs a second admin's approval and the delay (3.20).
   */
  async effectiveRetention(
    key: string,
    wanted: BackupRetention,
    requestedBy: string | null,
    now: Date,
  ): Promise<BackupRetention> {
    const repo = this.dataSource.getRepository(BackupRetentionEntity);
    const row = await repo.findOne({ where: { policy: key } });

    if (!row) {
      await repo.save(repo.create({ policy: key, effective: wanted }));

      return wanted;
    }

    const effective = backupRetentionSchema.parse(row.effective);

    if (sameRetention(effective, wanted)) return effective;

    if (!retentionShorter(effective, wanted)) {
      await repo.update({ policy: key }, { effective: wanted });
      await this.dataSource
        .getRepository(BackupDeletionEntity)
        .createQueryBuilder()
        .update()
        .set({ state: 'cancelled' })
        .where(`kind = 'retention' AND state IN ('pending', 'approved') AND retention->>'policy' = :key`, { key })
        .execute();

      return wanted;
    }

    // Rules that grow apply now; shrinking ones wait for the request.
    const interim = retentionMax(effective, wanted);

    if (!sameRetention(interim, effective)) await repo.update({ policy: key }, { effective: interim });

    const open = await this.dataSource
      .getRepository(BackupDeletionEntity)
      .createQueryBuilder('d')
      .where(`d.kind = 'retention' AND d.state IN ('pending', 'approved') AND d.retention->>'policy' = :key`, { key })
      .getMany();
    const same = open.find((d) => sameRetention(backupRetentionSchema.parse(d.retention?.spec ?? {}), wanted));

    for (const stale of open.filter((d) => d !== same))
      await this.dataSource.getRepository(BackupDeletionEntity).update({ id: stale.id }, { state: 'cancelled' });

    if (!same)
      await this.dataSource.transaction(async (manager) => {
        const deletion = await manager.getRepository(BackupDeletionEntity).save(
          manager.getRepository(BackupDeletionEntity).create({
            kind: 'retention',
            scope: key.startsWith('cluster/') ? 'cluster' : projectBackupScope(key.split('/')[0]),
            backupIds: [],
            retention: {
              policy: key,
              project: key.startsWith('cluster/') ? null : key.split('/')[0],
              spec: wanted as unknown as Record<string, unknown>,
            },
            reason: `retention of policy ${key} shortened`,
            state: 'pending',
            requestedBy: requestedBy ?? 'unknown',
            approvedBy: null,
            approvedAt: null,
            notBefore: new Date(now.getTime() + deletionDelayMs()),
            executedAt: null,
          }),
        );

        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'backup.retention-shortening-requested',
          target: `backup-policy/${key}`,
          details: { request: deletion.id, retention: wanted },
        });
      });

    return interim;
  }

  private async retain(key: string, spec: BackupPolicySpec, retention: BackupRetention, volumes: VolumeCandidate[]) {
    for (const volume of volumes) {
      const backups = await this.dataSource.getRepository(BackupEntity).find({
        where: { resource: volume.id, policy: key, status: 'succeeded', deletedAt: IsNull() },
      });

      if (!backups.length) continue;

      const keep = applyRetention(
        backups.map((b) => ({ id: b.id, time: b.startedAt })),
        retention,
        spec.timeZone ?? 'UTC',
      );
      const expired = backups.filter((b) => !keep.has(b.id));

      for (const b of backups.filter((x) => keep.has(x.id)))
        if ((keep.get(b.id) ?? []).join(',') !== b.keep.join(','))
          await this.dataSource.getRepository(BackupEntity).update({ id: b.id }, { keep: keep.get(b.id) ?? [] });

      if (expired.length) await this.deleteBackups(expired, { type: 'system' }, `retention of ${key}`);
    }
  }

  /** Deletes snapshots in the repository (control plane's FULL user) and marks the catalog rows. */
  async deleteBackups(
    backups: BackupEntity[],
    actor: { type: 'system' | 'user' | 'api-key'; id?: string | null },
    reason: string,
  ): Promise<void> {
    const byScope = new Map<string, BackupEntity[]>();
    // Control-plane data backups (3.20) live in the platform bucket, not in a Kopia repository.
    const platform = backups.filter((b) => b.resource.startsWith('platform/'));

    if (platform.length) {
      if (!this.platform) throw new Error('platform backups are not available on this replica');

      await this.platform.deleteBackups(platform, actor, reason);
    }

    for (const b of backups.filter((x) => !x.resource.startsWith('platform/')))
      byScope.set(b.scope, [...(byScope.get(b.scope) ?? []), b]);

    for (const [scope, rows] of byScope) {
      const control = await this.repositories.controlConnection(scope);
      const ids = rows.flatMap((r) => (r.snapshotId ? [r.snapshotId] : []));

      await this.repositories.cli.deleteSnapshots(control, ids);
      await this.dataSource.transaction(async (manager) => {
        await manager
          .getRepository(BackupEntity)
          .update({ id: In(rows.map((r) => r.id)) }, { deletedAt: new Date(), keep: [] });
        await this.audit.record(manager, {
          actor,
          action: 'backup.deleted',
          target: `backup-repository/${scope}`,
          project: rows[0].project,
          details: { backups: rows.map((r) => r.id), reason },
        });
      });
    }
  }

  private async executeDeletions(now: Date): Promise<void> {
    const approved = await this.dataSource
      .getRepository(BackupDeletionEntity)
      .find({ where: { state: 'approved', notBefore: LessThan(now) } });

    for (const request of approved.filter((r) => deletionDue(r, now))) {
      if (request.kind === 'backups') {
        const rows = await this.dataSource
          .getRepository(BackupEntity)
          .find({ where: { id: In(request.backupIds), deletedAt: IsNull() } });

        await this.deleteBackups(rows, { type: 'system' }, `deletion request ${request.id}`);
      } else if (request.retention) {
        await this.dataSource
          .getRepository(BackupRetentionEntity)
          .update(
            { policy: request.retention.policy },
            { effective: request.retention.spec as Record<string, number> },
          );
      }

      await this.dataSource.transaction(async (manager) => {
        await manager
          .getRepository(BackupDeletionEntity)
          .update({ id: request.id, state: 'approved' }, { state: 'executed', executedAt: now });
        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'backup.deletion-executed',
          target: `backup-deletion/${request.id}`,
          details: { kind: request.kind, scope: request.scope },
        });
      });
    }
  }

  // ------------------------------------------------------------------------------------------- restore tests

  private async restoreTests(
    key: string,
    spec: BackupPolicySpec,
    volumes: VolumeCandidate[],
    inventory: Inventory,
    now: Date,
  ): Promise<void> {
    if (!spec.restoreTest) return;

    const latest = latestScheduled({ schedules: [spec.restoreTest.schedule], timeZone: spec.timeZone }, now);

    if (!latest) return;

    for (const volume of volumes) {
      const last = await this.dataSource
        .getRepository(RestoreTestEntity)
        .findOne({ where: { resource: volume.id }, order: { startedAt: 'DESC' } });

      if (last?.status === 'running' || !volumeDue(latest, last?.startedAt ?? null)) continue;

      const backup = await this.dataSource.getRepository(BackupEntity).findOne({
        where: { resource: volume.id, status: 'succeeded', deletedAt: IsNull() },
        order: { startedAt: 'DESC' },
      });

      if (backup) await this.startRestoreTest(backup, inventory, now);
    }
  }

  async startRestoreTest(backup: BackupEntity, inventory?: Inventory, now = new Date()): Promise<RestoreTestEntity> {
    const inv = inventory ?? (await this.inventory());
    const placement = inv.placements.find((p) => p.id === backup.resource);
    const [project, deployment, volume] = backup.resource.split('/');
    const service = inv.parsed
      .find((d) => d.project === project && d.name === deployment)
      ?.compose.services.find(
        (s) => s.backup?.check && s.volumes.some((m) => m.type === 'volume' && m.source === volume),
      );
    const mount = service?.volumes.find((m) => m.type === 'volume' && m.source === volume);
    const check: RestoreCheck | undefined =
      service?.backup?.check && mount
        ? {
            image: service.image,
            command: service.backup.check.command,
            mountPath: mount.target,
            timeoutSeconds: service.backup.check.timeoutSeconds,
          }
        : undefined;
    const command: RestoreTestCommandSpec = {
      // Room for the scratch volume's LUKS header (16 MiB) and filesystem overhead.
      sizeBytes: Number(placement?.sizeBytes ?? 1024 ** 3) + 64 * 1024 ** 2,
      ...(check ? { check } : {}),
    };
    const repo = this.dataSource.getRepository(RestoreTestEntity);

    return await repo.save(
      repo.create({
        backupId: backup.id,
        scope: backup.scope,
        project: backup.project,
        resource: backup.resource,
        node: placement?.primaryNode ?? backup.node,
        status: 'running',
        keyGeneration: backup.keyGeneration,
        check: null,
        command: command as unknown as Record<string, unknown>,
        error: null,
        startedAt: now,
        finishedAt: null,
      }),
    );
  }

  // ------------------------------------------------------------------------------------------------- restores

  /** `Restore` resources: each generation runs once, on the node holding the target volume's primary. */
  private async restores(inventory: Inventory, now: Date): Promise<void> {
    for (const resource of inventory.resources.filter((r) => r.kind === 'Restore' && r.project)) {
      const project = resource.project as string;
      const exists = await this.dataSource
        .getRepository(RestoreEntity)
        .exists({ where: { project, name: resource.name, generation: resource.generation } });

      if (exists) continue;

      const spec = restoreSpecSchema.parse(resource.spec);
      const target = `${project}/${spec.target.deployment}/${spec.target.volume}`;
      const backup = await this.dataSource.getRepository(BackupEntity).findOne({ where: { id: spec.backup } });
      const placement = inventory.placements.find((p) => p.id === target);
      // Restores stay within their project: a backup of another project is refused.
      const error = !backup
        ? 'the backup does not exist'
        : backup.project !== project
          ? 'the backup belongs to another project'
          : backup.status !== 'succeeded' || backup.deletedAt
            ? 'the backup is not available'
            : !placement
              ? `volume ${spec.target.deployment}.${spec.target.volume} does not exist (yet)`
              : null;

      // A target volume created by the same plan may not be placed yet: wait for it (up to an hour).
      if (
        error &&
        !placement &&
        backup &&
        backup.project === project &&
        now.getTime() - resource.updatedAt.getTime() < 3_600_000
      )
        continue;

      const command: RestoreCommandSpec = {
        mode: spec.target.mode,
        ...(spec.target.path ? { path: spec.target.path } : {}),
        ...(spec.target.targetPath ? { targetPath: spec.target.targetPath } : {}),
        overwrite: spec.target.overwrite,
      };

      await this.dataSource.transaction(async (manager) => {
        const row = await manager.getRepository(RestoreEntity).save(
          manager.getRepository(RestoreEntity).create({
            project,
            name: resource.name,
            generation: resource.generation,
            backupId: spec.backup,
            volume: target,
            kind: spec.target.path ? 'path' : 'volume',
            status: error ? 'failed' : 'running',
            node: placement?.primaryNode ?? null,
            progress: null,
            command: command as unknown as Record<string, unknown>,
            error,
            startedAt: now,
            finishedAt: error ? now : null,
          }),
        );

        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: error ? 'backup.restore-refused' : 'backup.restore-started',
          target: `restore/${project}/${resource.name}`,
          project,
          details: { restore: row.id, backup: spec.backup, volume: target, ...(error ? { error } : {}) },
        });
      });
    }
  }

  // ------------------------------------------------------------------------------------------ secondary copies

  private async secondaryCopies(inventory: Inventory, now: Date): Promise<void> {
    const targets = new Map(
      inventory.resources
        .filter((r) => r.kind === 'BackupTarget')
        .map((r) => [r.name, backupTargetSpecSchema.parse(r.spec)] as const),
    );
    // Which scopes go to which targets (policies name their targets).
    const wanted = new Set<string>();

    for (const policy of inventory.resources.filter((r) => r.kind === 'BackupPolicy')) {
      const spec = backupPolicySpecSchema.parse(policy.spec);

      for (const volume of policyVolumes({ project: policy.project, spec }, inventory.volumes))
        for (const target of spec.targets) wanted.add(`${projectBackupScope(volume.project)}|${target}`);
    }

    if (!wanted.size) return;

    const store = await this.objectStore.backupsTarget();

    if (!store) return;

    const holder = store.holders.find((h) => nodeAddress(h));
    const endpoint = holder ? `${nodeAddress(holder)}:${objectStorePorts(store.generation).s3}` : null;

    if (!endpoint) return;

    for (const key of wanted) {
      const [scope, targetName] = key.split('|');
      const target = targets.get(targetName);
      const statusKey = `${targetName}|${scope}`;

      if (!target) {
        this.targetStatus.set(statusKey, {
          target: targetName,
          scope,
          at: now.toISOString(),
          ok: false,
          error: 'target not declared',
        });
        continue;
      }

      const pending = await this.dataSource
        .getRepository(BackupEntity)
        .createQueryBuilder('b')
        .where(`b.scope = :scope AND b.status = 'succeeded' AND b.deleted_at IS NULL`, { scope })
        .andWhere(`NOT b.targets @> :t::jsonb`, { t: JSON.stringify([{ target: targetName }]) })
        .getMany();

      if (!pending.length) continue;

      const started = new Date();

      try {
        const lockDays = await this.checkObjectLock(targetName, target);
        const connection = await this.repositories.directConnection(scope, endpoint, store.generation);

        await this.repositories.cli.syncTo(connection, await this.destination(target, scope));

        const copiedAt = new Date().toISOString();
        const lockedUntil = lockDays ? new Date(started.getTime() + lockDays * 86_400_000).toISOString() : null;

        for (const b of pending.filter((p) => (p.finishedAt ?? p.startedAt) <= started))
          await this.dataSource
            .getRepository(BackupEntity)
            .update({ id: b.id }, { targets: [...b.targets, { target: targetName, copiedAt, lockedUntil }] });

        this.targetStatus.set(statusKey, { target: targetName, scope, at: copiedAt, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.targetStatus.set(statusKey, {
          target: targetName,
          scope,
          at: new Date().toISOString(),
          ok: false,
          error: message,
        });
        this.logger.warn(`Secondary copy of ${scope} to ${targetName}: ${message}`);
      }
    }
  }

  /** S3 targets with object lock: the bucket's default retention must be at least the declared one. */
  private async checkObjectLock(name: string, target: BackupTargetSpec): Promise<number | null> {
    if (target.type !== 's3' || !target.objectLock) return null;

    const credentials = await this.credentials.providerConfig(target.credentials);
    const client = new S3Client({
      endpoint: target.endpoint,
      region: target.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: credentials['accessKeyId'] ?? '',
        secretAccessKey: credentials['secretAccessKey'] ?? '',
      },
    });

    try {
      const config = await client.send(new GetObjectLockConfigurationCommand({ Bucket: target.bucket }));
      const rule = config.ObjectLockConfiguration?.Rule?.DefaultRetention;
      const days = rule?.Days ?? (rule?.Years ? rule.Years * 365 : 0);

      if (config.ObjectLockConfiguration?.ObjectLockEnabled !== 'Enabled' || rule?.Mode !== target.objectLock.mode)
        throw new Error(`bucket ${target.bucket} of ${name} has no ${target.objectLock.mode} object lock`);

      if (days < target.objectLock.days)
        throw new Error(
          `bucket ${target.bucket} of ${name} locks for ${days} days, ${target.objectLock.days} declared`,
        );

      return days;
    } finally {
      client.destroy();
    }
  }

  private async destination(
    target: BackupTargetSpec,
    scope: string,
  ): Promise<{ args: string[]; env?: Record<string, string>; files?: Record<string, string> }> {
    if (target.type === 's3') {
      const url = new URL(target.endpoint);
      const credentials = await this.credentials.providerConfig(target.credentials);

      return {
        args: [
          's3',
          `--bucket=${target.bucket}`,
          `--endpoint=${url.host}`,
          `--region=${target.region}`,
          `--prefix=${target.prefix}${scope}/`,
          ...(url.protocol === 'http:' ? ['--disable-tls'] : []),
        ],
        env: {
          AWS_ACCESS_KEY_ID: credentials['accessKeyId'] ?? '',
          AWS_SECRET_ACCESS_KEY: credentials['secretAccessKey'] ?? '',
        },
      };
    }

    const key = (await this.credentials.read(target.keySecret)).toString('utf8');

    return {
      args: [
        'sftp',
        `--path=${target.path.replace(/\/$/, '')}/${scope}`,
        `--host=${target.host}`,
        `--port=${target.port}`,
        `--username=${target.user}`,
        '--keyfile={file:key}',
        '--known-hosts={file:known-hosts}',
      ],
      files: { key, 'known-hosts': target.knownHosts },
    };
  }
}
