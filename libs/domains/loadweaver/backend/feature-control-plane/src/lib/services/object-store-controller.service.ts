import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';
import { ObjectStoreGenerationEntity } from '../entities/object-store-generation.entity';
import { copyBucketBatch, garageS3Client, sweepBucketBatch } from '../object-store/bucket-copy';
import type { S3Client } from '@aws-sdk/client-s3';
import { GarageAdminClient } from '../object-store/garage-admin.client';
import {
  afterCopyBatch,
  copyBatchStart,
  nextObjectStoreStep,
  objectStoreMembers,
  objectStorePorts,
  objectStoreSecrets,
  BACKUPS_BUCKET,
  FILES_BUCKET,
  REGISTRY_BUCKET,
  type CopyCounts,
  type ObjectStoreSecrets,
} from '../object-store/object-store.utils';
import { AuditLogService } from './audit-log.service';
import { platformGarageKey } from '../backups/platform/platform-backups.utils';
import { PLATFORM_BUCKET } from '../backups/platform/s3-gateway.rules';
import { NetworkStateService } from './network-state.service';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 15_000;
const ADVISORY_LOCK_OBJECT_STORE = 0x4c570008;
/** Share of a holder's disk Garage may use (3.20); dedicated object-store node groups come with larger clusters. */
export const OBJECT_STORE_DISK_SHARE = 0.25;
const MIN_CAPACITY_BYTES = 1024 ** 3;
/** Registries get this long to switch to read-only before the final copy pass. */
export const READ_ONLY_SETTLE_MS = 30_000;
const COPY_BATCH = { maxObjects: 500, budgetMs: 20_000 };
/** Buckets moved to a new generation, in order. */
const COPIED_BUCKETS = [REGISTRY_BUCKET, FILES_BUCKET, BACKUPS_BUCKET, PLATFORM_BUCKET] as const;

export function nodeAddress(node: Pick<NodeEntity, 'overlayV4' | 'overlayV6'>): string | null {
  const address = node.overlayV4 ?? node.overlayV6;

  return address ? (address.includes(':') ? `[${address}]` : address) : null;
}

/**
 * Built-in object store (3.20), leader-elected across control-plane replicas: forms Garage generations on the
 * control-plane members over the overlay, keeps their layout in line with the membership, and moves data to a new
 * generation when the replication factor changes. The registry (3.22) is its first consumer.
 */
@Injectable()
export class ObjectStoreControllerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ObjectStoreControllerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /**
   * The members that are up and since when (this replica's view; a replica that just started counts from its start,
   * which only delays a growth): the replication factor grows once that set was stable too.
   */
  private up: { key: string | null; since: number } = { key: null, since: 0 };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
    private readonly audit: AuditLogService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env.LOADWEAVER_OBJECT_STORE ?? 'on') === 'off') return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (writesPaused('Object store', this.logger)) return;

    if (this.running) return;

    this.running = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Object store: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Where the control plane reaches a holder's Garage port (the overlay; overridable for tests). */
  protected endpoint(node: NodeEntity, port: number): string {
    const address = nodeAddress(node);

    if (!address) throw new Error(`node ${node.name} has no overlay address`);

    return `http://${address}:${port}`;
  }

  protected secrets(generation: number): ObjectStoreSecrets {
    const key = process.env.ENCRYPTION_KEY;

    if (!key) throw new Error('ENCRYPTION_KEY is required for the object store');

    return objectStoreSecrets(key, generation);
  }

  /** One step; returns the step taken. */
  async tick(now = Date.now()): Promise<string> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_OBJECT_STORE,
      ]);

      if (!locked) return { step: 'locked', changed: false };

      const repo = manager.getRepository(ObjectStoreGenerationEntity);
      const generations = await repo.find({ order: { generation: 'ASC' } });
      const nodes = await manager
        .getRepository(NodeEntity)
        .find({ where: { lifecycle: Not('left') }, order: { name: 'ASC' } });
      const members = objectStoreMembers(nodes);
      const up = members.filter((n) => n.connected).map((n) => n.name);
      const upKey = up.join(',');

      if (upKey !== this.up.key) this.up = { key: upKey, since: now };

      const step = nextObjectStoreStep(
        generations,
        members.map((n) => n.name),
        now,
        up,
        this.up.since,
      );
      const at = new Date(now);

      switch (step.kind) {
        case 'idle':
          return { step: step.kind, changed: false };
        case 'observe':
          await repo.update({ generation: step.generation }, { observedMembers: step.members, observedSince: at });

          return { step: step.kind, changed: false };
        case 'create':
          await repo.save(
            repo.create({
              generation: step.generation,
              replicationFactor: step.replicationFactor,
              state: 'provisioning',
              holders: step.holders,
              garageNodes: {},
              observedMembers: step.holders,
              observedSince: at,
              stateChangedAt: at,
              copy: null,
            }),
          );
          await this.audit.record(manager, {
            actor: { type: 'system' },
            action: 'object-store.generation-created',
            target: `object-store/${step.generation}`,
            details: { replicationFactor: step.replicationFactor, holders: step.holders },
          });

          return { step: step.kind, changed: true };
        case 'provision':
          return {
            step: step.kind,
            changed: await this.provision(
              manager,
              generations.find((g) => g.generation === step.generation) as ObjectStoreGenerationEntity,
              generations,
              nodes,
              at,
            ),
          };
        case 'copy':
          return {
            step: step.kind,
            changed: await this.copy(
              manager,
              generations.find((g) => g.generation === step.from) as ObjectStoreGenerationEntity,
              generations.find((g) => g.generation === step.to) as ObjectStoreGenerationEntity,
              nodes,
              now,
            ),
          };
        case 'rebalance':
          return {
            step: step.kind,
            changed: await this.rebalance(
              manager,
              generations.find((g) => g.generation === step.generation) as ObjectStoreGenerationEntity,
              step.members,
              nodes,
            ),
          };
        case 'abandon':
          await repo.update({ generation: step.generation }, { state: 'retired', stateChangedAt: at, holders: [] });
          await this.audit.record(manager, {
            actor: { type: 'system' },
            action: 'object-store.generation-abandoned',
            target: `object-store/${step.generation}`,
            details: { reason: 'a holder is no longer a control-plane member' },
          });

          return { step: step.kind, changed: true };
        case 'retire':
          await repo.update({ generation: step.generation }, { state: 'retired', stateChangedAt: at, holders: [] });
          await this.audit.record(manager, {
            actor: { type: 'system' },
            action: 'object-store.generation-retired',
            target: `object-store/${step.generation}`,
          });

          return { step: step.kind, changed: true };
      }
    });

    if (outcome.changed) this.network.requestRecompile('object store');

    return outcome.step;
  }

  private admin(generation: ObjectStoreGenerationEntity, node: NodeEntity): GarageAdminClient {
    return new GarageAdminClient(
      this.endpoint(node, objectStorePorts(generation.generation).admin),
      this.secrets(generation.generation).adminToken,
    );
  }

  /** Learns the holders' Garage ids, peers them and assigns the layout: zone = site, capacity from the disk. */
  private async layout(
    generation: ObjectStoreGenerationEntity,
    holders: NodeEntity[],
    storage: NodeEntity[],
  ): Promise<{ ids: Record<string, string>; applied: boolean } | null> {
    const ids: Record<string, string> = {};

    for (const node of holders) {
      try {
        ids[node.name] = generation.garageNodes[node.name] ?? (await this.admin(generation, node).selfId());
      } catch {
        // Not started yet; the agent picks the generation up from its desired state.
        return null;
      }
    }

    const [first] = holders;
    const admin = this.admin(generation, first);
    const ports = objectStorePorts(generation.generation);
    const failed = await admin.connect(holders.slice(1).map((n) => `${ids[n.name]}@${nodeAddress(n)}:${ports.rpc}`));

    if (failed.length > 0) return null;

    const layout = await admin.layout();
    const wanted = new Set(storage.map((n) => ids[n.name]));
    const roles = storage
      .filter((n) => !layout.roles.some((r) => r.id === ids[n.name]))
      .map((n) => ({
        id: ids[n.name],
        zone: n.site,
        capacity: Math.max(MIN_CAPACITY_BYTES, Math.floor((n.capacity?.diskBytes ?? 0) * OBJECT_STORE_DISK_SHARE)),
        tags: [n.name],
      }));
    const remove = layout.roles.filter((r) => !wanted.has(r.id)).map((r) => r.id);

    if (roles.length === 0 && remove.length === 0) return { ids, applied: false };

    await admin.stageLayout(roles, remove);
    await admin.applyLayout(layout.version + 1);

    return { ids, applied: true };
  }

  private async provision(
    manager: EntityManager,
    generation: ObjectStoreGenerationEntity,
    all: ObjectStoreGenerationEntity[],
    nodes: NodeEntity[],
    at: Date,
  ): Promise<boolean> {
    const holders = nodes.filter((n) => generation.holders.includes(n.name));

    if (holders.length < generation.replicationFactor) return false;

    const formed = await this.layout(generation, holders, holders);

    if (!formed) return false;

    const secrets = this.secrets(generation.generation);
    const admin = this.admin(generation, holders[0]);

    await admin.ensureKey(secrets.accessKeyId, secrets.secretAccessKey, 'lw-registry');
    await admin.ensureBucket(REGISTRY_BUCKET, secrets.accessKeyId);
    await admin.ensureKey(secrets.filesAccessKeyId, secrets.filesSecretAccessKey, 'lw-files');
    await admin.ensureBucket(FILES_BUCKET, secrets.filesAccessKeyId);
    await admin.ensureKey(secrets.backupsAccessKeyId, secrets.backupsSecretAccessKey, 'lw-backups');
    await admin.ensureBucket(BACKUPS_BUCKET, secrets.backupsAccessKeyId);

    const active = all.find((g) => g.state === 'active');

    await manager
      .getRepository(ObjectStoreGenerationEntity)
      .update(
        { generation: generation.generation },
        active
          ? { garageNodes: formed.ids, state: 'copying', stateChangedAt: at, copy: { phase: 'live', copied: 0 } }
          : { garageNodes: formed.ids, state: 'active', stateChangedAt: at },
      );
    await this.audit.record(manager, {
      actor: { type: 'system' },
      action: active ? 'object-store.copy-started' : 'object-store.generation-active',
      target: `object-store/${generation.generation}`,
      details: { holders: generation.holders },
    });

    return !active;
  }

  private s3(generation: ObjectStoreGenerationEntity, nodes: NodeEntity[], bucket: string = REGISTRY_BUCKET) {
    const node = nodes.find((n) => generation.holders.includes(n.name) && nodeAddress(n));

    if (!node) throw new Error(`object-store generation ${generation.generation} has no reachable holder`);

    const secrets = this.secrets(generation.generation);
    const files = bucket === FILES_BUCKET;
    const backups = bucket === BACKUPS_BUCKET;

    // Control-plane data backups (3.20): the backup gateway's own key.
    if (bucket === PLATFORM_BUCKET) {
      const platform = platformGarageKey(process.env.ENCRYPTION_KEY as string, generation.generation);

      return garageS3Client(
        this.endpoint(node, objectStorePorts(generation.generation).s3),
        platform.accessKeyId,
        platform.secretAccessKey,
      );
    }

    return garageS3Client(
      this.endpoint(node, objectStorePorts(generation.generation).s3),
      backups ? secrets.backupsAccessKeyId : files ? secrets.filesAccessKeyId : secrets.accessKeyId,
      backups ? secrets.backupsSecretAccessKey : files ? secrets.filesSecretAccessKey : secrets.secretAccessKey,
    );
  }

  private filesReady = new Set<number>();

  /**
   * An S3 client for the control plane's files bucket on the active generation (reports, 3.25); the key and bucket
   * are ensured once per generation (clusters formed before the files bucket existed get it here). Null without an
   * active object store.
   */
  async filesClient(): Promise<{ client: S3Client; bucket: string } | null> {
    const active = await this.dataSource
      .getRepository(ObjectStoreGenerationEntity)
      .findOne({ where: { state: 'active' } });

    if (!active) return null;

    const nodes = await this.dataSource.getRepository(NodeEntity).find();

    if (!(await this.ensureFiles(active, nodes))) return null;

    return { client: this.s3(active, nodes, FILES_BUCKET), bucket: FILES_BUCKET };
  }

  /** The files key and bucket on a generation (once per generation and replica; idempotent). */
  private async ensureFiles(generation: ObjectStoreGenerationEntity, nodes: NodeEntity[]): Promise<boolean> {
    if (this.filesReady.has(generation.generation)) return true;

    const holder = nodes.find((n) => generation.holders.includes(n.name) && nodeAddress(n));

    if (!holder) return false;

    const secrets = this.secrets(generation.generation);
    const admin = this.admin(generation, holder);

    await admin.ensureKey(secrets.filesAccessKeyId, secrets.filesSecretAccessKey, 'lw-files');
    await admin.ensureBucket(FILES_BUCKET, secrets.filesAccessKeyId);

    // The control-plane data backups (3.20) move with the generations too.
    const platform = platformGarageKey(process.env.ENCRYPTION_KEY as string, generation.generation);

    await admin.ensureKey(platform.accessKeyId, platform.secretAccessKey, 'lw-platform');
    await admin.ensureBucket(PLATFORM_BUCKET, platform.accessKeyId);
    this.filesReady.add(generation.generation);

    return true;
  }

  private backupsReady = new Set<number>();

  /**
   * The backups bucket of the active generation (3.20) and where the repository servers reach it; key and bucket
   * are ensured once per generation and replica. Null without an active object store.
   */
  async backupsTarget(): Promise<{
    generation: number;
    holders: NodeEntity[];
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  } | null> {
    const active = await this.dataSource
      .getRepository(ObjectStoreGenerationEntity)
      .findOne({ where: { state: 'active' } });

    if (!active) return null;

    const holders = (await this.dataSource.getRepository(NodeEntity).find()).filter(
      (n) => active.holders.includes(n.name) && nodeAddress(n),
    );

    if (!holders.length) return null;

    const secrets = this.secrets(active.generation);

    if (!this.backupsReady.has(active.generation)) {
      const admin = this.admin(active, holders[0]);

      await admin.ensureKey(secrets.backupsAccessKeyId, secrets.backupsSecretAccessKey, 'lw-backups');
      await admin.ensureBucket(BACKUPS_BUCKET, secrets.backupsAccessKeyId);
      this.backupsReady.add(active.generation);
    }

    return {
      generation: active.generation,
      holders,
      bucket: BACKUPS_BUCKET,
      accessKeyId: secrets.backupsAccessKeyId,
      secretAccessKey: secrets.backupsSecretAccessKey,
    };
  }

  /** Live pass, then the registries go read-only, then a final pass; then the new generation takes over. */
  private async copy(
    manager: EntityManager,
    from: ObjectStoreGenerationEntity,
    to: ObjectStoreGenerationEntity,
    nodes: NodeEntity[],
    now: number,
  ): Promise<boolean> {
    const repo = manager.getRepository(ObjectStoreGenerationEntity);
    const progress = to.copy ?? { phase: 'live' as const, copied: 0 };

    if (
      progress.phase === 'final' &&
      now - Date.parse(progress.readOnlySince ?? new Date(now).toISOString()) < READ_ONLY_SETTLE_MS
    )
      return false;

    // Every phase walks the registry bucket, then the files bucket (each with its own key), within one tick while
    // the batch budget lasts.
    const deadline = Date.now() + COPY_BATCH.budgetMs;
    let counts: CopyCounts = { copied: progress.copied, removed: progress.removed ?? 0 };

    // Generations formed before the files bucket existed get it before the copy.
    if (!(await this.ensureFiles(from, nodes)) || !(await this.ensureFiles(to, nodes))) return false;

    for (let index = progress.bucket ?? 0; index < COPIED_BUCKETS.length; index++) {
      const bucket = COPIED_BUCKETS[index];
      const source = this.s3(from, nodes, bucket);
      const target = this.s3(to, nodes, bucket);

      try {
        const run = progress.phase === 'sweep' ? sweepBucketBatch : copyBucketBatch;
        const start = copyBatchStart(progress.phase, counts);
        const batch = await run(
          source,
          target,
          bucket,
          index === (progress.bucket ?? 0)
            ? { continuationToken: progress.continuationToken, copied: start }
            : { copied: start },
          { maxObjects: COPY_BATCH.maxObjects, deadline },
        );

        counts = afterCopyBatch(progress.phase, counts, batch.copied);

        if (!batch.done) {
          await repo.update(
            { generation: to.generation },
            {
              copy: {
                ...progress,
                bucket: index,
                continuationToken: batch.continuationToken,
                copied: counts.copied,
                ...(progress.phase === 'sweep' ? { removed: counts.removed } : {}),
              },
            },
          );

          return false;
        }
      } finally {
        source.destroy();
        target.destroy();
      }
    }

    if (progress.phase === 'live') {
      // Registries become read-only (desired state), so the final pass sees everything.
      await repo.update(
        { generation: to.generation },
        { copy: { phase: 'final', copied: counts.copied, readOnlySince: new Date(now).toISOString() } },
      );

      return true;
    }

    if (progress.phase === 'final') {
      // Deleted tags and manifests must not come back in the new generation.
      await repo.update(
        { generation: to.generation },
        { copy: { phase: 'sweep', copied: counts.copied, removed: 0, readOnlySince: progress.readOnlySince } },
      );

      return false;
    }

    const at = new Date(now);

    await repo.update({ generation: from.generation }, { state: 'retiring', stateChangedAt: at });
    await repo.update(
      { generation: to.generation },
      { state: 'active', stateChangedAt: at, copy: null, observedMembers: to.holders, observedSince: at },
    );
    await this.audit.record(manager, {
      actor: { type: 'system' },
      action: 'object-store.generation-active',
      target: `object-store/${to.generation}`,
      details: { previous: from.generation, copied: counts.copied, removed: counts.removed },
    });

    return true;
  }

  /** Same replication factor: new members join the layout, former ones leave it once Garage moved their data. */
  private async rebalance(
    manager: EntityManager,
    generation: ObjectStoreGenerationEntity,
    members: string[],
    nodes: NodeEntity[],
  ): Promise<boolean> {
    const repo = manager.getRepository(ObjectStoreGenerationEntity);
    const union = [...new Set([...generation.holders, ...members])].sort();

    if (union.join(',') !== generation.holders.join(',')) {
      await repo.update({ generation: generation.generation }, { holders: union });

      return true;
    }

    const holders = nodes.filter((n) => union.includes(n.name));
    const formed = await this.layout(
      generation,
      holders,
      holders.filter((n) => members.includes(n.name)),
    );

    if (!formed) return false;

    await repo.update({ generation: generation.generation }, { garageNodes: formed.ids });

    if (
      formed.applied ||
      !(await this.admin(generation, holders.find((n) => members.includes(n.name)) as NodeEntity).layoutSynced())
    )
      return false;

    await repo.update({ generation: generation.generation }, { holders: [...members].sort() });

    return true;
  }
}
