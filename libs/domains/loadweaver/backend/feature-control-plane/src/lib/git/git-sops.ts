import {
  ageRecipientOf,
  envelopeDecrypt,
  envelopeEncrypt,
  generateAgeIdentity,
  sopsDecryptYaml,
} from '@forepath/loadweaver/shared/util-secrets';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { parseAllDocuments } from 'yaml';

import { GitSopsKeyEntity } from '../entities/git.entity';
import { AuditLogService } from '../services/audit-log.service';
import { MasterKeyService, sopsIdentityAad } from '../services/master-key.service';

/**
 * Decrypts SOPS-encrypted files of a Git sync (3.29) with the cluster's age identity. `ClusterSopsDecryptor` is the
 * implementation; `UnconfiguredSopsDecryptor` stays for setups (tests) without a master key.
 */
export abstract class GitSopsDecryptor {
  /** Whether decryption is available (the cluster can hold an age identity). */
  abstract readonly configured: boolean;

  /** The decrypted YAML of one file; throws (without values in the message) if it can't be decrypted. */
  abstract decrypt(path: string, text: string): Promise<string>;
}

/** Without SOPS support: SOPS files reject the sync with a clear reason. */
@Injectable()
export class UnconfiguredSopsDecryptor extends GitSopsDecryptor {
  readonly configured = false;

  async decrypt(path: string): Promise<string> {
    throw new Error(`${path} is SOPS-encrypted, but SOPS decryption is not configured on this cluster`);
  }
}

/** Whether a YAML file is SOPS-encrypted (a top-level `sops` metadata map in any document). */
export function isSopsFile(text: string | null | undefined): boolean {
  if (!text || !/^sops:\s*$/m.test(text)) return false;

  try {
    const parsed = parseAllDocuments(text);
    const docs = Array.isArray(parsed) ? parsed : [];

    return (
      docs.every((d) => d.errors.length === 0) &&
      docs
        .map((d) => d.toJS({ maxAliasCount: 0 }) as unknown)
        .some((v) => !!v && typeof v === 'object' && 'sops' in (v as Record<string, unknown>))
    );
  } catch {
    return false;
  }
}

/** The one identity per cluster. */
const IDENTITY_ID = 'cluster';

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * SOPS with the cluster's age identity (3.29): one X25519 identity per cluster, generated on first need; the public
 * recipient is stored in clear, the identity envelope-encrypted with the cluster master key (and re-wrapped with every
 * master key change). While the master key is sealed, SOPS files fail the sync with that reason.
 */
@Injectable()
export class ClusterSopsDecryptor extends GitSopsDecryptor {
  readonly configured = true;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly masterKey: MasterKeyService,
    private readonly audit: AuditLogService,
  ) {
    super();
  }

  /** The master key, or an error naming why SOPS can't work right now. */
  private async key(): Promise<{ id: string; value: Buffer }> {
    try {
      return await this.masterKey.current();
    } catch (error) {
      throw new Error(
        `the cluster master key is not available (${reason(error)}); SOPS files can't be decrypted until it is unsealed`,
      );
    }
  }

  /** The stored identity row; generated (and audited) on first need. */
  private async row(): Promise<GitSopsKeyEntity> {
    const repo = this.dataSource.getRepository(GitSopsKeyEntity);
    const existing = await repo.findOne({ where: { id: IDENTITY_ID } });

    if (existing) return existing;

    const key = await this.key();
    const pair = generateAgeIdentity();
    const sealed = envelopeEncrypt(key.value, Buffer.from(pair.identity, 'utf8'), sopsIdentityAad(IDENTITY_ID));

    await this.dataSource.transaction(async (manager) => {
      const inserted: unknown[] = await manager.query(
        `INSERT INTO "lw_git_sops_keys" ("id", "recipient", "key_id", "wrapped_key", "ciphertext")
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT ("id") DO NOTHING RETURNING "id"`,
        [IDENTITY_ID, pair.recipient, key.id, sealed.wrappedKey, sealed.ciphertext],
      );

      // Another replica may have been first: its identity wins.
      if (inserted.length > 0)
        await this.audit.record(manager, {
          actor: { type: 'system', id: null },
          action: 'git.sops.identity-created',
          target: `git/sops/${IDENTITY_ID}`,
          details: { recipient: pair.recipient, masterKey: key.id },
        });
    });

    return await repo.findOneOrFail({ where: { id: IDENTITY_ID } });
  }

  /** The public age recipient (`age1…`) teams encrypt to (`sops --age <recipient>`); created on first need. */
  async recipient(): Promise<{ recipient: string; createdAt: string }> {
    const row = await this.row();

    return { recipient: row.recipient, createdAt: row.createdAt.toISOString() };
  }

  /** The identity, decrypted in memory for one decryption. */
  private async identity(): Promise<string> {
    const row = await this.row();
    const key = await this.key();

    if (row.keyId !== key.id)
      throw new Error('the SOPS identity is wrapped by another master key; retry after the re-key finished');

    const identity = envelopeDecrypt(
      key.value,
      { wrappedKey: row.wrappedKey, ciphertext: row.ciphertext },
      sopsIdentityAad(row.id),
    );

    try {
      const text = identity.toString('utf8');

      if (ageRecipientOf(text) !== row.recipient)
        throw new Error('the stored SOPS identity does not match its recipient');

      return text;
    } finally {
      identity.fill(0);
    }
  }

  async decrypt(path: string, text: string): Promise<string> {
    let identity: string;

    try {
      identity = await this.identity();
    } catch (error) {
      throw new Error(`${path} is SOPS-encrypted: ${reason(error)}`);
    }

    try {
      return sopsDecryptYaml(text, [identity]);
    } catch (error) {
      // SOPS errors never contain values (paths and reasons only).
      throw new Error(`${path}: ${reason(error)}`);
    }
  }
}
