import {
  decodeShare,
  encodeShare,
  envelopeDecrypt,
  envelopeEncrypt,
  generateKey,
  open,
  seal,
  secretId,
  splitSecret,
} from '@forepath/loadweaver/shared/util-secrets';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

import { ClusterEntity } from '../entities/cluster.entity';
import { MasterKeyKmsRegistry } from '../kms/master-key-kms';
import { AuditLogService, type AuditActor } from '../services/audit-log.service';
import { MasterKeyService } from '../services/master-key.service';
import { BackupKeyEntity, type BackupKitShare } from './backup.entities';
import {
  backupDataKey,
  backupKeyAad,
  backupKitKey,
  combineKit,
  DEFAULT_KIT_SHARES,
  DEFAULT_KIT_THRESHOLD,
  kitShareAad,
  kitShareDocument,
  kitShareText,
  validateKitSize,
  type KitShareDocument,
} from './backup-keys.utils';

const ADVISORY_LOCK_BACKUP_KEYS = 0x4c570020;

export const BACKUP_KIT_SHARES_ENV = 'LOADWEAVER_BACKUP_KIT_SHARES';
export const BACKUP_KIT_THRESHOLD_ENV = 'LOADWEAVER_BACKUP_KIT_THRESHOLD';

export interface BackupKeyGenerationView {
  generation: number;
  rootId: string;
  active: boolean;
  createdAt: string;
  retiredAt: string | null;
  kit: {
    shares: number;
    threshold: number;
    downloaded: Array<{ index: number; downloadedAt: string | null; downloadedBy: string | null }>;
    confirmedAt: string | null;
    confirmedBy: string | null;
  };
  escrow: { provider: string; keyRef: string; at: string } | null;
}

export function kitDefaults(env: NodeJS.ProcessEnv = process.env): { shares: number; threshold: number } {
  const shares = Number(env[BACKUP_KIT_SHARES_ENV] ?? DEFAULT_KIT_SHARES);
  const threshold = Number(env[BACKUP_KIT_THRESHOLD_ENV] ?? DEFAULT_KIT_THRESHOLD);

  validateKitSize(shares, threshold);

  return { shares, threshold };
}

/**
 * Backup key hierarchy (3.20), separate from the cluster's day-to-day secrets: per generation a random root key,
 * envelope-encrypted with the master key (only through `MasterKeyService`; re-wrapped with every master-key
 * change like secrets), split into a Shamir recovery kit (download once per share, confirm by entering shares
 * back) and optionally escrowed in the configured KMS. Rotation creates a new generation; old ones stay for
 * restores. The 32-byte data key of a generation is derived from its root.
 *
 * Shared contract (control-plane data backups use it): `current()` and `forGeneration()`.
 */
@Injectable()
export class BackupKeyService {
  private readonly roots = new Map<number, { keyId: string; root: Buffer }>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly masterKey: MasterKeyService,
    private readonly kms: MasterKeyKmsRegistry,
    private readonly audit: AuditLogService,
  ) {}

  /** Data key of the active generation; creates generation 1 on first use. */
  async current(): Promise<{ generation: number; key: Buffer }> {
    let row = await this.dataSource.getRepository(BackupKeyEntity).findOne({ where: { active: true } });

    row ??= await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_BACKUP_KEYS]);

      return (
        (await manager.getRepository(BackupKeyEntity).findOne({ where: { active: true } })) ??
        (await this.createGeneration(manager, { type: 'system' }, kitDefaults()))
      );
    });

    return { generation: row.generation, key: backupDataKey(await this.rootOf(row), row.generation) };
  }

  /** Data key of any (also retired) generation, for restores. */
  async forGeneration(generation: number): Promise<Buffer> {
    const row = await this.dataSource.getRepository(BackupKeyEntity).findOne({ where: { generation } });

    if (!row) throw new NotFoundException(`backup key generation ${generation} does not exist`);

    return backupDataKey(await this.rootOf(row), generation);
  }

  async list(): Promise<BackupKeyGenerationView[]> {
    const rows = await this.dataSource.getRepository(BackupKeyEntity).find({ order: { generation: 'DESC' } });

    return rows.map(viewOf);
  }

  /** True when the active generation's kit is confirmed or the root is escrowed in a KMS. */
  async recoverable(): Promise<{ generation: number | null; kitConfirmed: boolean; escrowed: boolean }> {
    const row = await this.dataSource.getRepository(BackupKeyEntity).findOne({ where: { active: true } });

    return {
      generation: row?.generation ?? null,
      kitConfirmed: !!row?.kitConfirmedAt,
      escrowed: !!row?.escrow,
    };
  }

  /** New generation (rotation), with a new kit; the previous one stays for restores. */
  async rotate(actor: AuditActor, kit?: { shares: number; threshold: number }): Promise<BackupKeyGenerationView> {
    const size = kit ?? kitDefaults();

    validateKitSize(size.shares, size.threshold);

    const row = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_BACKUP_KEYS]);

      return await this.createGeneration(manager, actor, size);
    });

    return viewOf(row);
  }

  /**
   * Re-issues the kit of a generation (lost share before confirmation, other n / k): a new split of the same
   * root, previous shares stop matching the confirmation (they still reconstruct the root).
   */
  async reissueKit(
    generation: number,
    actor: AuditActor,
    size: { shares: number; threshold: number },
  ): Promise<BackupKeyGenerationView> {
    validateKitSize(size.shares, size.threshold);

    const row = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(BackupKeyEntity);
      const current = await repo.findOne({ where: { generation }, lock: { mode: 'pessimistic_write' } });

      if (!current) throw new NotFoundException(`backup key generation ${generation} does not exist`);

      const root = await this.rootOf(current);

      current.kit = sealKit(root, generation, size);
      current.kitShares = size.shares;
      current.kitThreshold = size.threshold;
      current.kitConfirmedAt = null;
      current.kitConfirmedBy = null;
      await repo.save(current);
      await this.audit.record(manager, {
        actor,
        action: 'backup-key.kit-reissued',
        target: `backup-key/${generation}`,
        details: size,
      });

      return current;
    });

    return viewOf(row);
  }

  /** Hands out one share exactly once (text + JSON with checksum); the stored copy is erased. */
  async downloadShare(
    generation: number,
    index: number,
    actor: AuditActor & { label: string },
  ): Promise<{ document: KitShareDocument; text: string }> {
    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(BackupKeyEntity);
      const row = await repo.findOne({ where: { generation }, lock: { mode: 'pessimistic_write' } });

      if (!row) throw new NotFoundException(`backup key generation ${generation} does not exist`);

      const entry = row.kit.find((s) => s.index === index);

      if (!entry) throw new NotFoundException(`the kit has no share ${index}`);

      if (!entry.sealed) throw new ConflictException(`share ${index} was already downloaded`);

      const root = await this.rootOf(row);
      const kitKey = backupKitKey(root, generation);
      let encoded: Buffer;

      try {
        encoded = open(kitKey, Buffer.from(entry.sealed, 'base64'), kitShareAad(generation, index));
      } finally {
        kitKey.fill(0);
      }

      const cluster = await manager.getRepository(ClusterEntity).findOneOrFail({ where: {} });
      const document = kitShareDocument({
        cluster: cluster.clusterId,
        generation,
        shares: row.kitShares,
        share: decodeShare(encoded.toString('utf8')),
        createdAt: row.createdAt,
      });

      encoded.fill(0);
      row.kit = row.kit.map((s) =>
        s.index === index
          ? { ...s, sealed: null, downloadedAt: new Date().toISOString(), downloadedBy: actor.label }
          : s,
      );
      await repo.save(row);
      await this.audit.record(manager, {
        actor,
        action: 'backup-key.kit-share-downloaded',
        target: `backup-key/${generation}`,
        details: { index },
      });

      return { document, text: kitShareText(document) };
    });
  }

  /** Confirms the kit by entering `threshold` shares back; they must reconstruct this generation's root. */
  async confirmKit(generation: number, shares: string[], actor: AuditActor & { label: string }): Promise<void> {
    const row = await this.dataSource.getRepository(BackupKeyEntity).findOne({ where: { generation } });

    if (!row) throw new NotFoundException(`backup key generation ${generation} does not exist`);

    let failure: string | null = null;

    try {
      combineKit(shares, row.rootId).fill(0);
    } catch (error) {
      failure = error instanceof Error ? error.message : 'the shares do not match';
    }

    await this.dataSource.transaction(async (manager) => {
      if (!failure)
        await manager
          .getRepository(BackupKeyEntity)
          .update({ generation }, { kitConfirmedAt: new Date(), kitConfirmedBy: actor.label });

      await this.audit.record(manager, {
        actor,
        action: failure ? 'backup-key.kit-confirm-failed' : 'backup-key.kit-confirmed',
        target: `backup-key/${generation}`,
        details: { shares: shares.length },
      });
    });

    if (failure) throw new BadRequestException(failure);
  }

  /** Escrows the generation's root in the configured KMS (reuses the master-key KMS providers). */
  async escrow(generation: number, actor: AuditActor): Promise<BackupKeyGenerationView> {
    const provider = this.kms.configured();

    if (!provider) throw new BadRequestException('no KMS is configured (LOADWEAVER_MASTER_KEY_KMS)');

    const row = await this.dataSource.getRepository(BackupKeyEntity).findOne({ where: { generation } });

    if (!row) throw new NotFoundException(`backup key generation ${generation} does not exist`);

    const root = await this.rootOf(row);
    const wrapped = await provider.wrap(root, `backup-${row.rootId}`);
    const escrow = { provider: provider.id, keyRef: provider.keyRef(), wrapped, at: new Date().toISOString() };

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(BackupKeyEntity).update({ generation }, { escrow });
      await this.audit.record(manager, {
        actor,
        action: 'backup-key.escrowed',
        target: `backup-key/${generation}`,
        details: { kms: provider.id, keyRef: escrow.keyRef },
      });
    });

    return viewOf({ ...row, escrow });
  }

  /**
   * Root key from the recovery kit or the KMS escrow, without the master key (disaster recovery on a fresh
   * node, 3.20 "asks for the recovery kit or the KMS first").
   */
  async recoverRoot(input: { shares: string[] } | { escrow: { provider: string; wrapped: string; rootId: string } }) {
    if ('shares' in input) return combineKit(input.shares);

    const root = await this.kms
      .get(input.escrow.provider)
      .unwrap(input.escrow.wrapped, `backup-${input.escrow.rootId}`);

    if (secretId(root) !== input.escrow.rootId) throw new Error('the KMS returned a different backup key');

    return root;
  }

  private async createGeneration(
    manager: EntityManager,
    actor: AuditActor,
    size: { shares: number; threshold: number },
  ): Promise<BackupKeyEntity> {
    const repo = manager.getRepository(BackupKeyEntity);
    const last = await repo.createQueryBuilder('k').select('MAX(k.generation)', 'max').getRawOne<{ max: number }>();
    const generation = Number(last?.max ?? 0) + 1;
    const root = generateKey();
    const master = await this.masterKey.current();
    const envelope = envelopeEncrypt(master.value, root, backupKeyAad(generation));

    await repo.update({ active: true }, { active: false, retiredAt: new Date() });

    const row = await repo.save(
      repo.create({
        generation,
        rootId: secretId(root),
        keyId: master.id,
        wrappedKey: envelope.wrappedKey,
        ciphertext: envelope.ciphertext,
        active: true,
        kitShares: size.shares,
        kitThreshold: size.threshold,
        kit: sealKit(root, generation, size),
        kitConfirmedAt: null,
        kitConfirmedBy: null,
        escrow: null,
        retiredAt: null,
      }),
    );

    this.roots.set(generation, { keyId: master.id, root });
    await this.audit.record(manager, {
      actor,
      action: 'backup-key.created',
      target: `backup-key/${generation}`,
      details: { rootId: row.rootId, ...size },
    });

    return row;
  }

  private async rootOf(row: BackupKeyEntity): Promise<Buffer> {
    const cached = this.roots.get(row.generation);

    if (cached && cached.keyId === row.keyId) return cached.root;

    const master = await this.masterKey.current();

    if (row.keyId !== master.id)
      throw new ConflictException(
        `backup key ${row.generation} is wrapped by another master key; retry after the re-key finished`,
      );

    const root = envelopeDecrypt(
      master.value,
      { wrappedKey: row.wrappedKey, ciphertext: row.ciphertext },
      backupKeyAad(row.generation),
    );

    if (secretId(root) !== row.rootId) throw new Error(`backup key ${row.generation} does not match its id`);

    this.roots.set(row.generation, { keyId: row.keyId, root });

    return root;
  }
}

function sealKit(root: Buffer, generation: number, size: { shares: number; threshold: number }): BackupKitShare[] {
  const kitKey = backupKitKey(root, generation);

  try {
    return splitSecret(root, size.shares, size.threshold).map((share) => {
      const encoded = Buffer.from(encodeShare(share), 'utf8');

      try {
        return {
          index: share.index,
          sealed: seal(kitKey, encoded, kitShareAad(generation, share.index)).toString('base64'),
          downloadedAt: null,
          downloadedBy: null,
        };
      } finally {
        encoded.fill(0);
      }
    });
  } finally {
    kitKey.fill(0);
  }
}

function viewOf(row: BackupKeyEntity): BackupKeyGenerationView {
  return {
    generation: row.generation,
    rootId: row.rootId,
    active: row.active,
    createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
    retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
    kit: {
      shares: row.kitShares,
      threshold: row.kitThreshold,
      downloaded: row.kit.map((s) => ({ index: s.index, downloadedAt: s.downloadedAt, downloadedBy: s.downloadedBy })),
      confirmedAt: row.kitConfirmedAt ? row.kitConfirmedAt.toISOString() : null,
      confirmedBy: row.kitConfirmedBy,
    },
    escrow: row.escrow ? { provider: row.escrow.provider, keyRef: row.escrow.keyRef, at: row.escrow.at } : null,
  };
}
