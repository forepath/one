import { createHash, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  backupTargetSpecSchema,
  clusterSpecSchema,
  type BackupTargetSpec,
} from '@forepath/loadweaver/shared/util-model';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not } from 'typeorm';
import { z } from 'zod';

import { DEFAULT_SITE } from '../../services/cluster-bootstrap.service';
import { JoinTokenEntity } from '../../entities/join-token.entity';
import { MasterKeyEntity } from '../../entities/master-key.entity';
import { NodeEntity } from '../../entities/node.entity';
import { ObjectStoreGenerationEntity } from '../../entities/object-store-generation.entity';
import { ResourceEntity } from '../../entities/resource.entity';
import { VolumePlacementEntity } from '../../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../../entities/workload-placement.entity';
import { garageS3Client } from '../../object-store/bucket-copy';
import { BACKUPS_BUCKET, objectStorePorts } from '../../object-store/object-store.utils';
import { AuditLogService } from '../../services/audit-log.service';
import { parseJoinToken } from '../../services/join-tokens.service';
import { MasterKeyService } from '../../services/master-key.service';
import { NetworkStateService } from '../../services/network-state.service';
import { ObjectStoreControllerService, nodeAddress } from '../../services/object-store-controller.service';
import { PlatformCredentialsService } from '../../services/platform-credentials.service';
import { WorkloadPlannerService } from '../../services/workload-planner.service';
import { samePlacements } from '../../utils/workload-planning.utils';
import { BackupEntity, BackupRepositoryEntity, RestoreEntity, RestoreTestEntity } from '../backup.entities';
import { BackupKeyService } from '../backup-keys.service';
import { repositoryPassword } from '../backup-keys.utils';
import { KopiaCli } from '../kopia-cli';
import { PlatformBackupStateEntity, PlatformRestoreEntity } from './platform-backups.entities';
import { PlatformBackupsService } from './platform-backups.service';
import { S3CopyDestination } from './platform-copy.destinations';
import { DrRecoveryEntity, PlatformCutoverEntity } from './platform-dr.entities';

/** `LOADWEAVER_DR_RECOVERY` as the agent's `bootstrap --restore` sets it on the first start of the restored API. */
export const drRecoveryEnvSchema = z
  .object({
    id: z.string().uuid(),
    node: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
    /** One-time join token of the restoring node. */
    token: z.string().max(128),
    /** Authenticates the agent's `/api/dr/*` calls (master key hand-over, status). */
    secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    restoreVolumes: z.boolean().default(true),
  })
  .strict();
export type DrRecoveryEnv = z.infer<typeof drRecoveryEnvSchema>;

export const DR_RECOVERY_ENV = 'LOADWEAVER_DR_RECOVERY';
const TICK_MS = 15_000;
const ADVISORY_LOCK_DR = 0x4c570037;

export interface DrStatusDto {
  id: string;
  node: string;
  state: string;
  previousNodes: string[];
  nodeJoined: boolean;
  /** The master key is held by the new member(s) (sealed to their keys): restarts unseal without the envelope. */
  masterKeyResealed: boolean;
  keyRestoredAt: string | null;
  reseed: Record<string, string>;
  volumes: Record<string, string>;
  completedAt: string | null;
  error: string | null;
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

/** Restores of a volume a recovery starts at most (a node still settling can refuse the first). */
export const DR_RESTORE_ATTEMPTS = 3;

/** `pending`, `pending#2`, `restoring:<id>#2`, … → the state and its attempt (from 1). */
export function volumeRestoreState(value: string): { state: string; attempt: number } {
  const match = /^(.*?)#(\d+)$/.exec(value);

  return match ? { state: match[1], attempt: Number(match[2]) } : { state: value, attempt: 1 };
}

export function readDrRecoveryEnv(env: NodeJS.ProcessEnv = process.env): DrRecoveryEnv | null {
  const raw = env[DR_RECOVERY_ENV];

  if (!raw) return null;

  const parsed = drRecoveryEnvSchema.safeParse(JSON.parse(raw));

  if (!parsed.success) throw new Error(`${DR_RECOVERY_ENV} is invalid: ${parsed.error.issues[0]?.message ?? ''}`);

  if (!parsed.data.token || !parseJoinToken(parsed.data.token))
    throw new Error(`${DR_RECOVERY_ENV}: invalid join token`);

  return parsed.data;
}

/** Name of the restore DR starts for a volume (unique per recovery and volume). */
export function drRestoreName(recoveryId: string, volumeId: string): string {
  const [, deployment, volume] = volumeId.split('/');

  return `dr-${recoveryId.slice(0, 8)}-${deployment}-${volume}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 128);
}

/**
 * Whole-cluster disaster recovery on the restored control plane (3.20, M6 step 3c). The agent's `bootstrap --restore`
 * restored etcd and the database from the external copy and starts the API with `LOADWEAVER_DR_RECOVERY` once:
 * 1. every previous node is marked lost (`left`, re-joins with a new token), the object store is formed anew on the
 *    new member, stale runs (backups, restores, clones, cut-overs) are failed, a join token for the restoring node;
 * 2. the agent hands over the master key from the DR envelope (`/api/dr/master-key`); the next membership re-share
 *    seals it to the new member;
 * 3. once the new object store is active, the Kopia repositories are re-seeded from the external targets (before any
 *    repository server starts on the empty bucket), a base backup restarts point-in-time recovery;
 * 4. volumes whose replicas were all lost are placed anew and restored from their newest backup;
 * 5. deployments are placed on the remaining nodes by the normal controllers.
 */
@Injectable()
export class DrRecoveryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DrRecoveryService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly kopia: KopiaCli;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly masterKey: MasterKeyService,
    private readonly keys: BackupKeyService,
    private readonly credentials: PlatformCredentialsService,
    private readonly objectStore: ObjectStoreControllerService,
    private readonly audit: AuditLogService,
    @Optional() private readonly network?: NetworkStateService,
    @Optional() private readonly platform?: PlatformBackupsService,
    @Optional() private readonly planner?: WorkloadPlannerService,
  ) {
    this.kopia = this.createKopia();
  }

  /** Overridable for tests. */
  protected createKopia(): KopiaCli {
    return new KopiaCli();
  }

  async onApplicationBootstrap(): Promise<void> {
    const env = readDrRecoveryEnv();

    if (env) await this.start(env);

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (this.ticking) return;

    this.ticking = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Disaster recovery: ${message(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Step 1, once per recovery id (later starts of the same API process find the row and do nothing). */
  async start(env: DrRecoveryEnv, now = new Date()): Promise<DrRecoveryEntity> {
    const row = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_DR]);

      const existing = await manager.getRepository(DrRecoveryEntity).findOne({ where: { id: env.id } });

      if (existing) return existing;

      const nodes = await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
      const previous = nodes.map((n) => n.name).sort();
      const lost = 'lost in a whole-cluster disaster recovery';

      // 1a. Every node of the lost cluster: left (re-joins under its name with a new token, 3.21).
      if (nodes.length)
        await manager
          .getRepository(NodeEntity)
          .update(
            { id: In(nodes.map((n) => n.id)) },
            { lifecycle: 'left', connected: false, lostConfirmedAt: now, controlPlane: false },
          );

      // 1b. The object store is formed anew on the new member (the old holders and their data are gone).
      await manager
        .getRepository(ObjectStoreGenerationEntity)
        .update({ state: Not('retired') }, { state: 'retired', holders: [], stateChangedAt: now });

      // 1c. Volumes whose every replica was on a lost node: placed anew (empty), restored from their backups.
      const lostSet = new Set(previous);
      const placements = await manager.getRepository(VolumePlacementEntity).find();
      const orphaned = placements.filter((p) =>
        [p.primaryNode, ...(p.syncReplicas ?? []), ...(p.remoteReplicas ?? [])].every((n) => !n || lostSet.has(n)),
      );

      if (orphaned.length)
        await manager.getRepository(VolumePlacementEntity).delete({ id: In(orphaned.map((p) => p.id)) });

      // 1d. Runs on lost nodes never finish.
      await manager
        .getRepository(BackupEntity)
        .update({ status: 'running' }, { status: 'failed', error: lost, finishedAt: now });
      await manager
        .getRepository(RestoreEntity)
        .update({ status: 'running' }, { status: 'failed', error: lost, finishedAt: now });
      await manager
        .getRepository(RestoreTestEntity)
        .update({ status: 'running' }, { status: 'failed', error: lost, finishedAt: now });
      await manager
        .getRepository(PlatformRestoreEntity)
        .update({ state: In(['requested', 'restoring', 'ready']) }, { state: 'failed', error: lost, finishedAt: now });
      await manager
        .getRepository(PlatformCutoverEntity)
        .update({ state: In(['planned', 'approved', 'switching']) }, { state: 'failed', error: lost, finishedAt: now });
      await manager
        .getRepository(PlatformBackupStateEntity)
        .update({ runningUntil: Not(IsNull()) }, { runningUntil: null });
      await manager.query('DELETE FROM lw_platform_backup_grants');
      // The new object store holds none of the copied objects: the external copy starts over (and never prunes what
      // it copied before the loss).
      await manager.query('DELETE FROM lw_platform_copies');

      // 1e. Kopia repositories: re-seeded from an external target before their servers start.
      const repositories = await manager.getRepository(BackupRepositoryEntity).find();
      const reseed = Object.fromEntries(repositories.map((r) => [r.scope, 'pending']));

      // 1f. The restoring node joins with its own one-time token.
      const parsed = parseJoinToken(env.token);

      if (parsed && !(await manager.getRepository(JoinTokenEntity).exists({ where: { tokenPrefix: parsed.prefix } })))
        await manager.getRepository(JoinTokenEntity).save(
          manager.getRepository(JoinTokenEntity).create({
            tokenPrefix: parsed.prefix,
            tokenHash: createHash('sha256').update(env.token).digest('hex'),
            description: 'disaster recovery node',
            site: (await manager.getRepository(ResourceEntity).exists({ where: { kind: 'Site', name: DEFAULT_SITE } }))
              ? DEFAULT_SITE
              : ((await manager.getRepository(ResourceEntity).findOne({ where: { kind: 'Site' } }))?.name ??
                DEFAULT_SITE),
            labels: {},
            witness: false,
            expiresAt: new Date(now.getTime() + 60 * 60_000),
            createdBy: 'system',
          }),
        );

      const saved = await manager.getRepository(DrRecoveryEntity).save(
        manager.getRepository(DrRecoveryEntity).create({
          id: env.id,
          node: env.node,
          state: 'started',
          previousNodes: previous,
          reseed,
          volumes: Object.fromEntries(orphaned.map((p) => [p.id, 'pending'])),
          restoreVolumes: env.restoreVolumes,
          error: null,
          startedAt: now,
          keyRestoredAt: null,
          replannedAt: null,
          completedAt: null,
        }),
      );

      await this.audit.record(manager, {
        actor: { type: 'system' },
        action: 'cluster.dr-recovery-started',
        target: `dr/${env.id}`,
        details: {
          node: env.node,
          previousNodes: previous,
          volumes: orphaned.length,
          repositories: repositories.length,
        },
      });

      return saved;
    });

    this.logger.warn(
      `Disaster recovery ${row.id}: restoring on ${row.node}; previous nodes marked lost: ${row.previousNodes.join(', ') || 'none'}`,
    );
    this.network?.requestRecompile('disaster recovery');

    return row;
  }

  /** Authenticates the restoring agent's calls (the secret it put into the API's environment). */
  private authenticate(secret: string | undefined): DrRecoveryEnv {
    const env = readDrRecoveryEnv();

    if (!env || !secret) throw new UnauthorizedException('no disaster recovery in progress');

    const a = Buffer.from(secret);
    const b = Buffer.from(env.secret);

    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('wrong recovery secret');

    return env;
  }

  /** Step 2: the master key from the DR envelope (the members holding its shares are gone). */
  async handOverMasterKey(secret: string | undefined, key: { id: string; value: string }): Promise<DrStatusDto> {
    const env = this.authenticate(secret);
    const value = Buffer.from(key.value, 'base64');

    try {
      await this.masterKey.recover({ id: key.id, value });
    } finally {
      value.fill(0);
    }

    await this.dataSource
      .getRepository(DrRecoveryEntity)
      .update({ id: env.id, keyRestoredAt: IsNull() }, { keyRestoredAt: new Date(), state: 'key-restored' });
    this.network?.requestRecompile('disaster recovery: master key');

    return await this.status(secret);
  }

  async status(secret: string | undefined): Promise<DrStatusDto> {
    const env = this.authenticate(secret);
    const row = await this.dataSource.getRepository(DrRecoveryEntity).findOneOrFail({ where: { id: env.id } });

    return await this.toDto(row);
  }

  private async toDto(row: DrRecoveryEntity): Promise<DrStatusDto> {
    const node = await this.dataSource.getRepository(NodeEntity).findOne({ where: { name: row.node } });
    const key = await this.dataSource.getRepository(MasterKeyEntity).findOne({ where: { active: true } });
    const nodeJoined = !!node && node.lifecycle !== 'left' && node.joinedAt.getTime() >= row.startedAt.getTime();

    return {
      id: row.id,
      node: row.node,
      state: row.state,
      previousNodes: row.previousNodes,
      nodeJoined,
      masterKeyResealed:
        !!key &&
        (!!key.kms || (nodeJoined && !this.masterKey.awaitingReseal && key.holders.some((h) => h.node === row.node))),
      keyRestoredAt: row.keyRestoredAt?.toISOString() ?? null,
      reseed: row.reseed,
      volumes: row.volumes,
      completedAt: row.completedAt?.toISOString() ?? null,
      error: row.error,
    };
  }

  /** Steps 3–4 for every open recovery. */
  async tick(now = new Date()): Promise<void> {
    const open = await this.dataSource.getRepository(DrRecoveryEntity).find({ where: { completedAt: IsNull() } });

    for (const row of open) {
      // Deployments and volumes go to the nodes that exist once the restoring node joined (5).
      if (!row.replannedAt) await this.replan(row, now);

      // Repository passwords derive from the backup key, which the master key unwraps (after a restart of this API
      // the new member's agent unseals it).
      if (
        !(await this.masterKey
          .current()
          .then(() => true)
          .catch(() => false))
      )
        continue;

      const pending = Object.entries(row.reseed).filter(([, s]) => s === 'pending');

      if (pending.length) {
        // Bounded: a holder of a forming generation may not answer yet.
        const store = await Promise.race([
          this.objectStore.backupsTarget().catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 60_000).unref()),
        ]);

        if (!store) continue; // the new object store isn't active yet

        const reseed = { ...row.reseed };

        for (const [scope] of pending) reseed[scope] = await this.reseed(scope, store);

        await this.dataSource.getRepository(DrRecoveryEntity).update({ id: row.id }, { reseed });
        this.network?.requestRecompile('disaster recovery: repositories re-seeded');
        // Point-in-time recovery restarts with a base backup on the new object store.
        void this.platform
          ?.run('postgres', { type: 'system' })
          .catch((error: unknown) => this.logger.warn(`Base backup after the recovery: ${message(error)}`));

        continue;
      }

      const volumes = row.restoreVolumes ? await this.restoreVolumes(row, now) : row.volumes;
      const finished = Object.values(volumes).every((v) => {
        const { state } = volumeRestoreState(v);

        return state !== 'pending' && !state.startsWith('restoring:');
      });

      await this.dataSource.getRepository(DrRecoveryEntity).update(
        { id: row.id },
        {
          volumes,
          ...(finished ? { state: 'completed' as const, completedAt: now } : {}),
        },
      );

      if (finished)
        await this.audit.recordStandalone({
          actor: { type: 'system' },
          action: 'cluster.dr-recovery-completed',
          target: `dr/${row.id}`,
          details: { reseed: row.reseed, volumes },
        });
    }
  }

  /**
   * Places every deployment again (failover mode: moves directly) once the restoring node is a member: replicas of
   * lost nodes go to the nodes that exist, volumes whose replicas were all lost are created anew (empty, restored
   * below). Returns true when it ran.
   */
  private async replan(row: DrRecoveryEntity, now: Date): Promise<boolean> {
    if (!this.planner) return false;

    const node = await this.dataSource.getRepository(NodeEntity).findOne({ where: { name: row.node } });

    if (!node || node.lifecycle !== 'active' || node.joinedAt.getTime() < row.startedAt.getTime() || !node.controlPlane)
      return false;

    const planner = this.planner;
    const outcome = await this.dataSource.transaction(async (manager) => {
      const resources = await manager.getRepository(ResourceEntity).find();
      const cluster = clusterSpecSchema.parse(resources.find((r) => r.kind === 'Cluster')?.spec);
      const plan = await planner.plan(manager, resources);
      const missing = plan.schedule.unschedulable.map((u) => `${u.replica}: ${u.reason}`);
      // Until everything fits (e.g. volumes need a second node that is still joining), planned again every pass —
      // but persisted (and recompiled) only when the placements it computes differ from what is placed.
      const changed = !samePlacements(await planner.current(manager), plan.schedule);

      if (changed) await planner.persist(manager, plan, cluster.network, 'failover');

      if (missing.length === 0) {
        await manager.getRepository(DrRecoveryEntity).update({ id: row.id }, { replannedAt: now });
        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'workload.failover',
          target: `dr/${row.id}`,
          details: { reason: 'disaster recovery' },
        });
      }

      return { missing, changed };
    });

    if (outcome.missing.length)
      this.logger.warn(`Disaster recovery: not placed yet (${outcome.missing.join('; ').slice(0, 500)})`);

    if (outcome.changed) this.network?.requestRecompile('disaster recovery: placements');

    return true;
  }

  /** Where the control plane reaches a holder's S3 port (overridable for tests). */
  protected garageEndpoint(holder: NodeEntity, generation: number): string {
    return `http://${nodeAddress(holder)}:${objectStorePorts(generation).s3}`;
  }

  /**
   * Copies a repository's blobs from the first external target that has it into the new object store: S3 targets
   * object by object (same flat layout), SFTP targets through `kopia repository sync-to` (Kopia shards SFTP paths).
   */
  private async reseed(
    scope: string,
    store: NonNullable<Awaited<ReturnType<ObjectStoreControllerService['backupsTarget']>>>,
  ): Promise<string> {
    const targets = (await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'BackupTarget' } }))
      .map((r) => ({ name: r.name, spec: backupTargetSpecSchema.safeParse(r.spec) }))
      .filter((t) => t.spec.success)
      .map((t) => ({ name: t.name, spec: t.spec.data as BackupTargetSpec }));
    const endpoint = this.garageEndpoint(store.holders[0], store.generation);
    const errors: string[] = [];

    for (const target of targets) {
      try {
        const copied =
          target.spec.type === 's3'
            ? await this.reseedFromS3(scope, target.spec, endpoint, store)
            : await this.reseedFromSftp(scope, target.spec, endpoint, store);

        if (copied) {
          this.logger.log(`Repository ${scope} re-seeded from ${target.name}`);
          await this.audit.recordStandalone({
            actor: { type: 'system' },
            action: 'backup.repository-reseeded',
            target: `backup-repository/${scope}`,
            details: { from: target.name },
          });

          return 'done';
        }
      } catch (error) {
        errors.push(`${target.name}: ${message(error)}`);
      }
    }

    return errors.length ? `failed: ${errors.join('; ').slice(0, 500)}` : 'missing';
  }

  private async reseedFromS3(
    scope: string,
    spec: Extract<BackupTargetSpec, { type: 's3' }>,
    endpoint: string,
    store: { bucket: string; accessKeyId: string; secretAccessKey: string },
  ): Promise<boolean> {
    const credentials = await this.credentials.providerConfig(spec.credentials);
    const source = new S3CopyDestination(spec, {
      accessKeyId: credentials['accessKeyId'] ?? '',
      secretAccessKey: credentials['secretAccessKey'] ?? '',
    });
    const garage = garageS3Client(endpoint, store.accessKeyId, store.secretAccessKey);

    try {
      const objects = await source.list(`${scope}/`);

      if (!objects.some((o) => o.key === `${scope}/kopia.repository.f` || o.key === `${scope}/kopia.repository`))
        return false;

      for (const object of objects) {
        const body: Readable = await source.get(object.key);

        await garage.send(
          new PutObjectCommand({ Bucket: BACKUPS_BUCKET, Key: object.key, Body: body, ContentLength: object.size }),
        );
      }

      return true;
    } finally {
      await source.close();
      garage.destroy();
    }
  }

  private async reseedFromSftp(
    scope: string,
    spec: Extract<BackupTargetSpec, { type: 'sftp' }>,
    endpoint: string,
    store: { accessKeyId: string; secretAccessKey: string },
  ): Promise<boolean> {
    const repository = await this.dataSource.getRepository(BackupRepositoryEntity).findOneOrFail({ where: { scope } });
    const password = repositoryPassword(await this.keys.forGeneration(repository.keyGeneration), scope);
    const key = (await this.credentials.read(spec.keySecret)).toString('utf8');

    await this.kopia.syncFromExternal(
      {
        args: [
          'sftp',
          `--path=${spec.path.replace(/\/$/, '')}/${scope}`,
          `--host=${spec.host}`,
          `--port=${spec.port}`,
          `--username=${spec.user}`,
          '--keyfile={file:key}',
          '--known-hosts={file:known-hosts}',
        ],
        files: { key, 'known-hosts': spec.knownHosts },
      },
      password,
      { endpoint: endpoint.replace(/^https?:\/\//, ''), bucket: BACKUPS_BUCKET, prefix: `${scope}/`, ...store },
    );

    return true;
  }

  /**
   * Step 4: each volume DR re-placed gets a restore of its newest backup once its new primary runs it (the
   * deployment may already use the empty volume: the restore replaces the content and restarts its containers).
   */
  private async restoreVolumes(row: DrRecoveryEntity, now: Date): Promise<Record<string, string>> {
    const volumes = { ...row.volumes };

    for (const [volumeId, value] of Object.entries(volumes)) {
      const { state, attempt } = volumeRestoreState(value);

      if (state.startsWith('restoring:')) {
        const restore = await this.dataSource
          .getRepository(RestoreEntity)
          .findOne({ where: { id: state.slice('restoring:'.length) } });

        if (restore && restore.status !== 'running' && restore.status !== 'pending')
          volumes[volumeId] =
            restore.status === 'done'
              ? `restored:${restore.id}`
              : attempt < DR_RESTORE_ATTEMPTS
                ? `pending#${attempt + 1}`
                : `failed:${restore.error ?? restore.status}`;

        continue;
      }

      if (state !== 'pending') continue;

      const backup = await this.dataSource.getRepository(BackupEntity).findOne({
        where: { resource: volumeId, status: 'succeeded', deletedAt: IsNull() },
        order: { startedAt: 'DESC' },
      });

      if (!backup) {
        volumes[volumeId] = 'no backup';
        continue;
      }

      if (row.reseed[backup.scope] && row.reseed[backup.scope] !== 'done') {
        volumes[volumeId] = `repository ${backup.scope} ${row.reseed[backup.scope]}`;
        continue;
      }

      const placement = await this.dataSource.getRepository(VolumePlacementEntity).findOne({ where: { id: volumeId } });

      if (!placement) continue;

      const [project, deployment] = volumeId.split('/');
      const primary = await this.dataSource
        .getRepository(NodeEntity)
        .findOne({ where: { name: placement.primaryNode } });
      // The volume exists on its new primary once a replica of the deployment runs there (it mounts the volume).
      const running = (
        await this.dataSource.getRepository(WorkloadPlacementEntity).find({ where: { project, deployment } })
      ).some((p) => p.node === placement.primaryNode && p.status?.[p.node]?.state === 'running');

      if (!primary?.connected || !running) continue;

      const restore = await this.dataSource.getRepository(RestoreEntity).save(
        this.dataSource.getRepository(RestoreEntity).create({
          project,
          name: drRestoreName(row.id, volumeId),
          generation: attempt,
          backupId: backup.id,
          volume: volumeId,
          kind: 'volume',
          status: 'running',
          node: placement.primaryNode,
          progress: null,
          command: { mode: 'replace', overwrite: true },
          error: null,
          startedAt: now,
          finishedAt: null,
        }),
      );

      await this.audit.recordStandalone({
        actor: { type: 'system' },
        action: 'backup.restore-started',
        target: `restore/${project}/${restore.name}`,
        project,
        details: { restore: restore.id, backup: backup.id, volume: volumeId, reason: 'disaster recovery', attempt },
      });
      volumes[volumeId] = `restoring:${restore.id}${attempt > 1 ? `#${attempt}` : ''}`;
    }

    return volumes;
  }
}
