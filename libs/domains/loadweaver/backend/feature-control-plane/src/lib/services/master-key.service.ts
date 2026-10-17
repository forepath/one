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
import { MasterKeyEntity, type MasterKeyHolder, type MasterKeyKms } from '../entities/master-key.entity';
import { MasterKeyKmsRegistry } from '../kms/master-key-kms';
import { NodeEntity } from '../entities/node.entity';
import { SecretEntity } from '../entities/secret.entity';
import { UnsealRequestEntity, UnsealShareEntity } from '../entities/unseal.entity';
import { AuditLogService } from './audit-log.service';

export const UNSEAL_CHANNEL = 'lw_unseal';
const ADVISORY_LOCK_MASTER_KEY = 0x4c570005;
const UNSEAL_TIMEOUT_MS = 20_000;
const POLL_MS = 250;

export function shareAad(keyId: string, node: string): string {
  return `master-key/${keyId}/${node}`;
}

/** Majority of the holders (1 of 1, 2 of 2, 2 of 3, 3 of 5). */
export function thresholdFor(holders: number): number {
  return holders <= 2 ? holders : Math.floor(holders / 2) + 1;
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

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: AgentSessionRegistry,
    private readonly audit: AuditLogService,
    private readonly kms: MasterKeyKmsRegistry,
  ) {}

  get unsealed(): boolean {
    return this.key !== null;
  }

  private async holders(manager: EntityManager): Promise<NodeEntity[]> {
    return await manager
      .getRepository(NodeEntity)
      .find({ where: { controlPlane: true, lifecycle: Not('left') }, order: { name: 'ASC' } });
  }

  private async seal(
    value: Buffer,
    holders: NodeEntity[],
  ): Promise<{ id: string; threshold: number; holders: MasterKeyHolder[]; kms: MasterKeyKms | null }> {
    const provider = this.kms.configured();

    if (provider) {
      const id = secretId(value);

      return {
        id,
        threshold: 0,
        holders: [],
        kms: { provider: provider.id, keyRef: provider.keyRef(), wrapped: await provider.wrap(value, id) },
      };
    }

    const usable = holders.filter((h) => !!h.sealPublicKey);

    if (usable.length === 0)
      throw new ServiceUnavailableException('no control-plane member can hold a master-key share yet');

    const threshold = thresholdFor(usable.length);
    const shares = splitSecret(value, usable.length, threshold);

    return {
      id: shares[0].secretId,
      threshold,
      kms: null,
      holders: usable.map((node, i) => ({
        node: node.name,
        encryptedShare: sealTo(
          node.sealPublicKey as string,
          Buffer.from(encodeShare(shares[i])),
          shareAad(shares[0].secretId, node.name),
        ).toString('base64'),
      })),
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
      const sealed = await this.seal(value, await this.holders(manager));

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
      const deadline = Date.now() + UNSEAL_TIMEOUT_MS;

      while (Date.now() < deadline) {
        const shares = await this.dataSource.getRepository(UnsealShareEntity).find({ where: { requestId } });

        if (shares.length >= row.threshold) {
          const decoded = shares.map((s) =>
            decodeShare(
              openSealed(ephemeral.privateKey, Buffer.from(s.sealedShare, 'base64'), `unseal/${requestId}`).toString(),
            ),
          );
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

  /** Stores a share an agent re-encrypted for the requester; only holders of that key are accepted. */
  async accept(node: string, payload: { requestId: string; keyId: string; sealedShare: string }): Promise<void> {
    const row = await this.dataSource.getRepository(MasterKeyEntity).findOne({ where: { id: payload.keyId } });
    const request = await this.dataSource
      .getRepository(UnsealRequestEntity)
      .findOne({ where: { id: payload.requestId, keyId: payload.keyId } });

    if (!row || !request || !row.holders.some((h) => h.node === node)) return;

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
      const holders = (await this.holders(manager)).filter((h) => !!h.sealPublicKey);

      if (!row || row.id !== old.id) return null;

      const provider = this.kms.configured();

      if (
        provider
          ? row.kms?.provider === provider.id && row.kms.keyRef === provider.keyRef()
          : !row.kms &&
            holders.map((h) => h.name).join(',') ===
              row.holders
                .map((h) => h.node)
                .sort()
                .join(',')
      )
        return null;

      const value = generateKey();
      const sealed = await this.seal(value, holders);
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

      await manager.getRepository(MasterKeyEntity).update({ id: row.id }, { active: false, retiredAt: new Date() });
      await manager
        .getRepository(MasterKeyEntity)
        .save(manager.getRepository(MasterKeyEntity).create({ ...sealed, active: true, retiredAt: null }));
      await this.audit.record(manager, {
        actor: { type: 'system' },
        action: 'master-key.reshare',
        target: `master-key/${sealed.id}`,
        details: { previous: row.id, ...describeSealing(sealed), rewrapped: secrets.length },
      });

      return { id: sealed.id, value };
    });

    if (!next) return false;

    this.key = next;
    old.value.fill(0);

    return true;
  }

  /** Holders of the active key, for reporting (single node = weaker, 3.22). */
  async describe(): Promise<{
    id: string;
    threshold: number;
    holders: string[];
    kms: { provider: string; keyRef: string } | null;
  } | null> {
    const row = await this.dataSource.getRepository(MasterKeyEntity).findOne({ where: { active: true } });

    return row
      ? {
          id: row.id,
          threshold: row.threshold,
          holders: row.holders.map((h) => h.node),
          kms: row.kms ? { provider: row.kms.provider, keyRef: row.kms.keyRef } : null,
        }
      : null;
  }
}

/** Audit details of how a key is held (never the key or the wrapped value). */
function describeSealing(sealed: {
  threshold: number;
  holders: MasterKeyHolder[];
  kms: MasterKeyKms | null;
}): Record<string, unknown> {
  return sealed.kms
    ? { kms: sealed.kms.provider, keyRef: sealed.kms.keyRef }
    : { threshold: sealed.threshold, holders: sealed.holders.map((h) => h.node) };
}
