import { randomUUID } from 'node:crypto';

import { controlPlaneMessage } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  combineShares,
  decodeShare,
  encodeShare,
  generateKey,
  generateSealKeyPair,
  openSealed,
  rewrapKey,
  sealTo,
  secretId,
  splitSecret,
} from '@forepath/loadweaver/shared/util-secrets';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not } from 'typeorm';

import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { BuiltinMemberService, type BuiltinSealTarget } from '../builtin-member/builtin-member.service';
import { BackupKeyEntity } from '../backups/backup.entities';
import { backupKeyAad } from '../backups/backup-keys.utils';
import {
  MasterKeyEntity,
  type MasterKeyHolder,
  type MasterKeyKms,
  type MasterKeyStandby,
} from '../entities/master-key.entity';
import { MasterKeyKmsRegistry } from '../kms/master-key-kms';
import { NodeEntity } from '../entities/node.entity';
import { GitSopsKeyEntity } from '../entities/git.entity';
import { SecretEntity } from '../entities/secret.entity';
import { UnsealRequestEntity, UnsealShareEntity } from '../entities/unseal.entity';
import {
  BUILTIN_HOLDER,
  builtinHolderPlan,
  builtinStandbyAad,
  type BuiltinHolderPlan,
  type BuiltinMemberRole,
} from '../utils/builtin-member.utils';
import { AuditLogService } from './audit-log.service';

export const UNSEAL_CHANNEL = 'lw_unseal';
const ADVISORY_LOCK_MASTER_KEY = 0x4c570005;
const UNSEAL_TIMEOUT_MS = 20_000;
const POLL_MS = 250;

/** Associated data of the cluster's SOPS age identity envelope (3.29). */
export function sopsIdentityAad(id: string): string {
  return `git-sops/${id}`;
}

export function shareAad(keyId: string, node: string): string {
  return `master-key/${keyId}/${node}`;
}

/** Majority of the holders (1 of 1, 2 of 2, 2 of 3, 3 of 5). */
export function thresholdFor(holders: number): number {
  return holders <= 2 ? holders : Math.floor(holders / 2) + 1;
}

interface Sealing {
  id: string;
  threshold: number;
  holders: MasterKeyHolder[];
  kms: MasterKeyKms | null;
  builtinStandby: MasterKeyStandby | null;
}

/** Who holds the key for a sealing: the real members plus the built-in control-plane member's plan (3.39). */
interface HolderSet {
  members: NodeEntity[];
  builtin: BuiltinSealTarget | null;
  plan: BuiltinHolderPlan;
}

/** How the built-in control-plane member takes part in the active key, for the cluster summary / inbox (3.39). */
export interface BuiltinKeyRole {
  role: BuiltinMemberRole;
  /** Holds a share of the active key. */
  holder: boolean;
  /** Holds an in-sync standby copy of the active key. */
  standby: boolean;
  /** Real control-plane members with a seal key (the takeover rule looks at this, not at reachability). */
  realMembers: number;
}

/**
 * Cluster master key (3.22): split Shamir-style across the control-plane members, each share sealed to its node,
 * or wrapped by an external KMS / Vault when one is configured. A replica unseals by collecting a threshold of
 * shares re-encrypted to its ephemeral key (or by asking the KMS); it then keeps the key in memory only.
 * Single-node clusters hold one share locally, which the plan reports as weaker.
 */
@Injectable()
export class MasterKeyService {
  private readonly logger = new Logger(MasterKeyService.name);
  private key: { id: string; value: Buffer } | null = null;
  private unsealing: Promise<{ id: string; value: Buffer }> | null = null;
  /** Set by a disaster recovery: the next re-share seals to the new members even if their names didn't change. */
  private resealAfterRecovery = false;
  /** How long `unseal()` waits for share holders (tests shorten it). */
  unsealTimeoutMs = UNSEAL_TIMEOUT_MS;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: AgentSessionRegistry,
    private readonly audit: AuditLogService,
    private readonly kms: MasterKeyKmsRegistry,
    private readonly builtin: BuiltinMemberService,
  ) {}

  get unsealed(): boolean {
    return this.key !== null;
  }

  /** Real control-plane members (not `left`) with a seal key: the share holders. */
  private async members(manager: EntityManager): Promise<NodeEntity[]> {
    return (
      await manager
        .getRepository(NodeEntity)
        .find({ where: { controlPlane: true, lifecycle: Not('left') }, order: { name: 'ASC' } })
    ).filter((h) => !!h.sealPublicKey);
  }

  /**
   * The holder set (3.39, user decision 2026-10-29): the threshold uses the real members only; the built-in member is
   * the sole holder while there are none and otherwise keeps a standby copy (`always`: also a share).
   */
  private async holderSet(manager: EntityManager): Promise<HolderSet> {
    const members = await this.members(manager);
    const builtin = await this.builtin.sealTarget(manager);

    return { members, builtin, plan: builtinHolderPlan(members.length, builtin?.mode ?? null) };
  }

  private async seal(value: Buffer, set: HolderSet): Promise<Sealing> {
    const provider = this.kms.configured();

    if (provider) {
      const id = secretId(value);

      return {
        id,
        threshold: 0,
        holders: [],
        kms: { provider: provider.id, keyRef: provider.keyRef(), wrapped: await provider.wrap(value, id) },
        builtinStandby: null,
      };
    }

    const recipients: { name: string; publicKey: string; builtin: boolean }[] = set.members.map((node) => ({
      name: node.name,
      publicKey: node.sealPublicKey as string,
      builtin: false,
    }));

    if (set.plan.share && set.builtin)
      recipients.push({ name: BUILTIN_HOLDER, publicKey: set.builtin.publicKey, builtin: true });

    if (recipients.length === 0)
      throw new ServiceUnavailableException('no control-plane member can hold a master-key share yet');

    const threshold = thresholdFor(recipients.length);
    const shares = splitSecret(value, recipients.length, threshold);
    const id = shares[0].secretId;

    return {
      id,
      threshold,
      kms: null,
      holders: recipients.map((r, i) => ({
        node: r.name,
        encryptedShare: sealTo(r.publicKey, Buffer.from(encodeShare(shares[i])), shareAad(id, r.name)).toString(
          'base64',
        ),
        ...(r.builtin ? { kind: 'builtin' as const, publicKey: r.publicKey } : {}),
      })),
      builtinStandby: set.plan.standby && set.builtin ? standbyFor(value, id, set.builtin.publicKey) : null,
    };
  }

  /** The unsealed key; creates the cluster's first key or unseals an existing one. */
  async current(): Promise<{ id: string; value: Buffer }> {
    if (this.key) return this.key;

    this.unsealing ??= this.load().finally(() => (this.unsealing = null));

    return await this.unsealing;
  }

  private async load(): Promise<{ id: string; value: Buffer }> {
    const created = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_MASTER_KEY]);

      if (await manager.getRepository(MasterKeyEntity).exists({ where: { active: true } })) return null;

      const value = generateKey();
      const sealed = await this.seal(value, await this.holderSet(manager));

      await manager
        .getRepository(MasterKeyEntity)
        .save(manager.getRepository(MasterKeyEntity).create({ ...sealed, active: true, retiredAt: null }));
      await this.audit.record(manager, {
        actor: { type: 'system' },
        action: 'master-key.create',
        target: `master-key/${sealed.id}`,
        details: describeSealing(sealed),
      });

      return { id: sealed.id, value };
    });

    this.key = created ?? (await this.unseal());

    // Moving between shares and a KMS (or to another KMS key) re-keys like a membership change does.
    if (!created)
      await this.reshare().catch((error: unknown) =>
        this.logger.warn(`Master key re-key deferred: ${error instanceof Error ? error.message : String(error)}`),
      );

    return this.key;
  }

  /**
   * Whole-cluster disaster recovery (3.20): the members holding the shares are gone, so the key comes from the DR
   * envelope (opened with the backup recovery kit or the KMS escrow). Accepted only if it is the active key; it is then
   * held in memory and the next re-share seals it to the new members (also when a new member reuses an old name).
   */
  async recover(key: { id: string; value: Buffer }): Promise<void> {
    const row = await this.dataSource.getRepository(MasterKeyEntity).findOne({ where: { active: true } });

    if (!row) throw new ServiceUnavailableException('no master key');

    if (key.id !== row.id || secretId(key.value) !== row.id)
      throw new ServiceUnavailableException('the recovered key is not the active master key');

    this.key = { id: row.id, value: Buffer.from(key.value) };
    this.resealAfterRecovery = !row.kms;
    await this.audit.recordStandalone({
      actor: { type: 'system' },
      action: 'master-key.recovered',
      target: `master-key/${row.id}`,
      details: describeSealing(row),
    });
    this.logger.warn(`Master key ${row.id} recovered from the DR envelope; re-sealing to the current members`);
  }

  /** Whether a recovered key still waits for its re-share to the new members. */
  get awaitingReseal(): boolean {
    return this.resealAfterRecovery;
  }

  /** Collects a threshold of shares through the holders' agents, re-encrypted to an ephemeral key of this replica. */
  async unseal(): Promise<{ id: string; value: Buffer }> {
    const row = await this.dataSource.getRepository(MasterKeyEntity).findOne({ where: { active: true } });

    if (!row) throw new ServiceUnavailableException('no master key');

    if (row.kms) {
      const value = await this.kms.get(row.kms.provider).unwrap(row.kms.wrapped, row.id);

      if (secretId(value) !== row.id) throw new ServiceUnavailableException('the KMS returned a different master key');

      this.logger.log(`Unsealed master key ${row.id} through KMS ${row.kms.provider}`);

      return { id: row.id, value };
    }

    // Takeover (3.39): with no real control-plane member registered any more (removed / deregistered, not merely
    // unreachable), the built-in member's in-sync standby copy opens the key.
    const realMembers = (await this.members(this.dataSource.manager)).length;

    if (realMembers === 0 && row.builtinStandby && this.builtin.canOpen(row.builtinStandby.publicKey)) {
      const value = this.builtin.open(row.builtinStandby.sealedKey, builtinStandbyAad(row.id));

      if (secretId(value) !== row.id) {
        value.fill(0);
        throw new ServiceUnavailableException('the built-in standby copy is not the active master key');
      }

      this.logger.warn(
        `Unsealed master key ${row.id} from the built-in member's standby copy: no control-plane member is registered`,
      );

      return { id: row.id, value };
    }

    // The built-in member's own share opens locally, without a round trip.
    const local: ReturnType<typeof decodeShare>[] = [];
    const builtinHolder = row.holders.find((h) => h.node === BUILTIN_HOLDER);

    if (builtinHolder && this.builtin.canOpen(builtinHolder.publicKey)) {
      const share = this.builtin.open(builtinHolder.encryptedShare, shareAad(row.id, BUILTIN_HOLDER));

      try {
        local.push(decodeShare(share.toString()));
      } finally {
        share.fill(0);
      }
    }

    if (local.length >= row.threshold) {
      this.logger.log(`Unsealed master key ${row.id} with the built-in control-plane member's share`);

      return { id: row.id, value: combineShares(local) };
    }

    const ephemeral = generateSealKeyPair();
    const requestId = randomUUID();

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(UnsealRequestEntity)
        .save(
          manager
            .getRepository(UnsealRequestEntity)
            .create({ id: requestId, keyId: row.id, requesterPublicKey: ephemeral.publicKey }),
        );
      await manager.query('SELECT pg_notify($1, $2)', [UNSEAL_CHANNEL, requestId]);
    });

    try {
      const deadline = Date.now() + this.unsealTimeoutMs;

      while (Date.now() < deadline) {
        const shares = (await this.dataSource.getRepository(UnsealShareEntity).find({ where: { requestId } })).filter(
          // The local share already counts; a relayed copy of it from another replica would be a duplicate.
          (s) => local.length === 0 || s.node !== BUILTIN_HOLDER,
        );

        if (shares.length + local.length >= row.threshold) {
          const decoded = [
            ...local,
            ...shares.map((s) =>
              decodeShare(
                openSealed(
                  ephemeral.privateKey,
                  Buffer.from(s.sealedShare, 'base64'),
                  `unseal/${requestId}`,
                ).toString(),
              ),
            ),
          ];
          const value = combineShares(decoded);

          this.logger.log(`Unsealed master key ${row.id} with ${decoded.length} of ${row.holders.length} shares`);

          return { id: row.id, value };
        }

        await new Promise((r) => setTimeout(r, POLL_MS));
      }

      throw new ServiceUnavailableException(`master key is sealed: fewer than ${row.threshold} share holders answered`);
    } finally {
      await this.dataSource.getRepository(UnsealRequestEntity).delete({ id: requestId });
    }
  }

  /** On `lw_unseal`: forwards the request to every share holder connected to this replica. */
  async relay(requestId: string): Promise<void> {
    const request = await this.dataSource.getRepository(UnsealRequestEntity).findOne({ where: { id: requestId } });

    if (!request) return;

    const row = await this.dataSource.getRepository(MasterKeyEntity).findOne({ where: { id: request.keyId } });

    for (const holder of row?.holders ?? []) {
      if (holder.node === BUILTIN_HOLDER) {
        await this.relayBuiltin(request, holder);
        continue;
      }

      this.sessions.get(holder.node)?.send(
        controlPlaneMessage('unsealShareRequest', {
          requestId,
          keyId: request.keyId,
          encryptedShare: holder.encryptedShare,
          requesterPublicKey: request.requesterPublicKey,
        }),
      );
    }
  }

  /**
   * The built-in member answers for its share like an agent does (re-sealed to the requester's ephemeral key), so
   * replicas without the key file can unseal through this one. Only for a key it holds a share of: the standby copy
   * is never handed out.
   */
  private async relayBuiltin(request: UnsealRequestEntity, holder: MasterKeyHolder): Promise<void> {
    if (!this.builtin.canOpen(holder.publicKey)) return;

    const share = this.builtin.open(holder.encryptedShare, shareAad(request.keyId, BUILTIN_HOLDER));

    try {
      const sealed = sealTo(request.requesterPublicKey, share, `unseal/${request.id}`);

      await this.dataSource
        .getRepository(UnsealShareEntity)
        .createQueryBuilder()
        .insert()
        .values({ requestId: request.id, node: BUILTIN_HOLDER, sealedShare: sealed.toString('base64') })
        .orIgnore()
        .execute();
    } finally {
      share.fill(0);
    }
  }

  /** Stores a share an agent re-encrypted for the requester; only holders of that key are accepted. */
  async accept(node: string, payload: { requestId: string; keyId: string; sealedShare: string }): Promise<void> {
    const row = await this.dataSource.getRepository(MasterKeyEntity).findOne({ where: { id: payload.keyId } });
    const request = await this.dataSource
      .getRepository(UnsealRequestEntity)
      .findOne({ where: { id: payload.requestId, keyId: payload.keyId } });

    if (!row || !request || node === BUILTIN_HOLDER || !row.holders.some((h) => h.node === node)) return;

    await this.dataSource
      .getRepository(UnsealShareEntity)
      .createQueryBuilder()
      .insert()
      .values({ requestId: payload.requestId, node, sealedShare: payload.sealedShare })
      .orIgnore()
      .execute();
  }

  /**
   * Re-splits when the control-plane membership changed: a new key for the current members, all data keys
   * re-wrapped (secret ciphertexts untouched), the old shares retired.
   */
  async reshare(): Promise<boolean> {
    if (!this.key) return false;

    const old = this.key;

    const next = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_MASTER_KEY]);

      const row = await manager.getRepository(MasterKeyEntity).findOne({ where: { active: true } });
      const set = await this.holderSet(manager);

      if (!row || row.id !== old.id) return null;

      const provider = this.kms.configured();
      const wanted = [
        ...set.members.map((h) => h.name),
        ...(set.plan.share && set.builtin ? [`${BUILTIN_HOLDER}#${set.builtin.publicKey}`] : []),
      ]
        .sort()
        .join(',');
      const current = row.holders
        .map((h) => (h.node === BUILTIN_HOLDER ? `${BUILTIN_HOLDER}#${h.publicKey ?? ''}` : h.node))
        .sort()
        .join(',');

      if (
        !this.resealAfterRecovery &&
        (provider
          ? row.kms?.provider === provider.id && row.kms.keyRef === provider.keyRef()
          : !row.kms && wanted === current)
      ) {
        // Same holders: only the standby copy may need to follow (new / replaced / switched-off built-in member).
        if (!provider) await this.syncStandby(manager, row, old, set);

        return null;
      }

      // After a recovery: only once a new member can hold a share (else wait for the next membership change).
      if (this.resealAfterRecovery && !provider && set.members.length === 0 && !(set.plan.share && set.builtin))
        return null;

      const value = generateKey();
      const sealed = await this.seal(value, set);
      const secrets = await manager.getRepository(SecretEntity).find({ where: { keyId: row.id } });

      for (const secret of secrets) {
        const aad = `secret://${secret.project}/${secret.name}@${secret.version}`;

        await manager
          .getRepository(SecretEntity)
          .update(
            { id: secret.id },
            { keyId: sealed.id, wrappedKey: rewrapKey(old.value, value, secret.wrappedKey, aad) },
          );
      }

      // The cluster's SOPS age identity (3.29) is wrapped the same way.
      const sopsKeys = await manager.getRepository(GitSopsKeyEntity).find({ where: { keyId: row.id } });

      for (const key of sopsKeys)
        await manager
          .getRepository(GitSopsKeyEntity)
          .update(
            { id: key.id },
            { keyId: sealed.id, wrappedKey: rewrapKey(old.value, value, key.wrappedKey, sopsIdentityAad(key.id)) },
          );

      // Backup root keys (3.20) as well; their kit / KMS escrow is independent of the master key.
      const backupKeys = await manager.getRepository(BackupKeyEntity).find({ where: { keyId: row.id } });

      for (const key of backupKeys)
        await manager.getRepository(BackupKeyEntity).update(
          { generation: key.generation },
          {
            keyId: sealed.id,
            wrappedKey: rewrapKey(old.value, value, key.wrappedKey, backupKeyAad(key.generation)),
          },
        );

      // The retired row drops its standby copy: an old DB dump plus the state volume can't open a retired key with it.
      await manager
        .getRepository(MasterKeyEntity)
        .update({ id: row.id }, { active: false, retiredAt: new Date(), builtinStandby: null });
      await manager
        .getRepository(MasterKeyEntity)
        .save(manager.getRepository(MasterKeyEntity).create({ ...sealed, active: true, retiredAt: null }));
      await this.audit.record(manager, {
        actor: { type: 'system' },
        action: 'master-key.reshare',
        target: `master-key/${sealed.id}`,
        details: {
          previous: row.id,
          ...describeSealing(sealed),
          rewrapped: secrets.length + sopsKeys.length + backupKeys.length,
        },
      });

      return { id: sealed.id, value };
    });

    if (!next) return false;

    this.key = next;
    this.resealAfterRecovery = false;
    old.value.fill(0);

    return true;
  }

  /**
   * Keeps the built-in member's standby copy of the active key in sync without re-keying (the key is unsealed here):
   * added when the member registers, re-sealed when its key was replaced, dropped when it is switched off.
   */
  private async syncStandby(
    manager: EntityManager,
    row: MasterKeyEntity,
    key: { id: string; value: Buffer },
    set: HolderSet,
  ): Promise<void> {
    const wantedKey = set.plan.standby && set.builtin ? set.builtin.publicKey : null;

    if ((row.builtinStandby?.publicKey ?? null) === wantedKey) return;

    const builtinStandby = wantedKey ? standbyFor(key.value, row.id, wantedKey) : null;

    await manager.getRepository(MasterKeyEntity).update({ id: row.id }, { builtinStandby });
    await this.audit.record(manager, {
      actor: { type: 'system' },
      action: 'master-key.standby-sync',
      target: `master-key/${row.id}`,
      details: { holder: BUILTIN_HOLDER, standby: !!builtinStandby },
    });
    this.logger.log(
      builtinStandby
        ? `Built-in control-plane member: standby copy of master key ${row.id} sealed`
        : `Built-in control-plane member: standby copy of master key ${row.id} removed`,
    );
  }

  /** How the built-in control-plane member takes part in the active key (3.39). */
  async builtinRole(): Promise<BuiltinKeyRole> {
    const [row, members, target] = await Promise.all([
      this.dataSource.getRepository(MasterKeyEntity).findOne({ where: { active: true } }),
      this.members(this.dataSource.manager),
      this.builtin.sealTarget(),
    ]);
    const holder = !!row?.holders.some((h) => h.node === BUILTIN_HOLDER);
    const standby = !!row?.builtinStandby && row.builtinStandby.publicKey === target?.publicKey;

    return {
      role: builtinHolderPlan(members.length, target?.mode ?? null).role,
      holder,
      standby,
      realMembers: members.length,
    };
  }

  /** Holders of the active key, for reporting (single node = weaker, 3.22). */
  async describe(): Promise<{
    id: string;
    threshold: number;
    holders: string[];
    kms: { provider: string; keyRef: string } | null;
    builtinStandby: boolean;
  } | null> {
    const row = await this.dataSource.getRepository(MasterKeyEntity).findOne({ where: { active: true } });

    return row
      ? {
          id: row.id,
          threshold: row.threshold,
          holders: row.holders.map((h) => h.node),
          kms: row.kms ? { provider: row.kms.provider, keyRef: row.kms.keyRef } : null,
          builtinStandby: !!row.builtinStandby,
        }
      : null;
  }
}

/** The whole key sealed to the built-in member's public key (3.39 standby copy). */
function standbyFor(value: Buffer, keyId: string, publicKey: string): MasterKeyStandby {
  return {
    holder: BUILTIN_HOLDER,
    publicKey,
    sealedKey: sealTo(publicKey, value, builtinStandbyAad(keyId)).toString('base64'),
  };
}

/** Audit details of how a key is held (never the key or the wrapped value). */
function describeSealing(sealed: {
  threshold: number;
  holders: MasterKeyHolder[];
  kms: MasterKeyKms | null;
  builtinStandby?: MasterKeyStandby | null;
}): Record<string, unknown> {
  return sealed.kms
    ? { kms: sealed.kms.provider, keyRef: sealed.kms.keyRef }
    : {
        threshold: sealed.threshold,
        holders: sealed.holders.map((h) => h.node),
        ...(sealed.builtinStandby ? { standby: sealed.builtinStandby.holder } : {}),
      };
}
