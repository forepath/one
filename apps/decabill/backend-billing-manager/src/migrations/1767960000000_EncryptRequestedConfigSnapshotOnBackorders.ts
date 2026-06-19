import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

function createAes256GcmTransformer(): {
  to(plain?: string | null): string | null;
  from(stored?: string | null): string | null;
} {
  const envKeyB64 = process.env.ENCRYPTION_KEY;
  let key: Buffer;

  if (envKeyB64 && envKeyB64.length > 0) {
    try {
      key = Buffer.from(envKeyB64, 'base64');
    } catch {
      throw new Error('ENCRYPTION_KEY must be base64-encoded');
    }

    if (key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to 32 bytes (AES-256).');
    }
  } else {
    key = Buffer.alloc(32, 0x11);
  }

  return {
    to(plain?: string | null): string | null {
      if (plain == null) return plain as null;

      if (plain === '') return '';

      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();

      return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
    },
    from(stored?: string | null): string | null {
      if (stored == null) return stored as null;

      if (stored === '') return '';

      const parts = stored.split(':');

      if (parts.length !== 3) return stored;

      const [ivB64, tagB64, dataB64] = parts;
      const iv = Buffer.from(ivB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      const data = Buffer.from(dataB64, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);

      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

      return decrypted.toString('utf8');
    },
  };
}

interface RequestedConfigRowUp {
  id: string;
  requested_config_snapshot: Record<string, unknown> | null;
}

interface RequestedConfigRowDown {
  id: string;
  requested_config_snapshot: string | null;
}

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];

  const withRows = result as { rows?: unknown[] };

  return (withRows.rows ?? []) as T[];
}

/**
 * Migrates requested_config_snapshot on billing_backorders from jsonb to encrypted text using AES-256-GCM.
 * Preserves existing data; down() reverts to plain jsonb.
 */
export class EncryptRequestedConfigSnapshotOnBackorders1767960000000 implements MigrationInterface {
  name = 'EncryptRequestedConfigSnapshotOnBackorders1767960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_backorders',
      new TableColumn({
        name: 'requested_config_snapshot_encrypted',
        type: 'text',
        isNullable: true,
      }),
    );

    const gcm = createAes256GcmTransformer();
    const result = await queryRunner.query('SELECT id, requested_config_snapshot FROM billing_backorders');
    const rawRows = getRows<RequestedConfigRowUp>(result);

    for (const row of rawRows) {
      const payload = row.requested_config_snapshot ?? {};
      const json = JSON.stringify(payload);
      const encrypted = gcm.to(json);

      await queryRunner.query('UPDATE billing_backorders SET requested_config_snapshot_encrypted = $1 WHERE id = $2', [
        encrypted,
        row.id,
      ]);
    }

    await queryRunner.dropColumn('billing_backorders', 'requested_config_snapshot');
    await queryRunner.renameColumn(
      'billing_backorders',
      'requested_config_snapshot_encrypted',
      'requested_config_snapshot',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_backorders',
      new TableColumn({
        name: 'requested_config_snapshot_jsonb',
        type: 'jsonb',
        isNullable: true,
        default: "'{}'::jsonb",
      }),
    );

    const gcm = createAes256GcmTransformer();
    const result = await queryRunner.query('SELECT id, requested_config_snapshot FROM billing_backorders');
    const rawRows = getRows<RequestedConfigRowDown>(result);

    for (const row of rawRows) {
      const decrypted = row.requested_config_snapshot ? gcm.from(row.requested_config_snapshot) : '{}';
      const json = decrypted ?? '{}';

      await queryRunner.query(
        'UPDATE billing_backorders SET requested_config_snapshot_jsonb = $1::jsonb WHERE id = $2',
        [json, row.id],
      );
    }

    await queryRunner.dropColumn('billing_backorders', 'requested_config_snapshot');
    await queryRunner.renameColumn(
      'billing_backorders',
      'requested_config_snapshot_jsonb',
      'requested_config_snapshot',
    );
  }
}
