import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates a ColumnTransformer that transparently encrypts/decrypts string values using AES-256-GCM.
 * Mirrors the encrypt-snapshot migrations so this rewrite can read/write encrypted columns.
 */
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

      if (parts.length !== 3) {
        return stored;
      }

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

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];

  const withRows = result as { rows?: unknown[] };

  return (withRows.rows ?? []) as T[];
}

const LEGACY_TO_CANONICAL: Record<string, string> = {
  controller: 'agenstra-controller',
  manager: 'agenstra-manager',
};
const CANONICAL_TO_LEGACY: Record<string, string> = {
  'agenstra-controller': 'controller',
  'agenstra-manager': 'manager',
};

function rewriteServiceId(value: unknown, map: Record<string, string>): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return map[value];
}

function rewriteProvisioningOptionKey(value: unknown, map: Record<string, string>): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('integrated:')) {
    return undefined;
  }

  const rawService = value.slice('integrated:'.length);
  const rewritten = map[rawService];

  return rewritten ? `integrated:${rewritten}` : undefined;
}

function rewriteServiceIdList(values: unknown, map: Record<string, string>): { changed: boolean; values: unknown } {
  if (!Array.isArray(values)) {
    return { changed: false, values };
  }

  let changed = false;
  const next = values.map((entry) => {
    const rewritten = rewriteServiceId(entry, map);

    if (!rewritten) {
      return entry;
    }

    changed = true;

    return rewritten;
  });

  return { changed, values: next };
}

/**
 * Rewrites integrated service ids inside plan defaults / config snapshots.
 * Kept inline (non-exported) so TypeORM does not treat this as a migration class.
 */
function rewriteIntegratedServiceIdsInConfig(
  config: Record<string, unknown>,
  direction: 'toCanonical' | 'toLegacy',
): { changed: boolean; config: Record<string, unknown> } {
  const map = direction === 'toCanonical' ? LEGACY_TO_CANONICAL : CANONICAL_TO_LEGACY;
  let changed = false;
  const next: Record<string, unknown> = { ...config };
  const rewrittenService = rewriteServiceId(next['service'], map);

  if (rewrittenService) {
    next['service'] = rewrittenService;
    changed = true;
  }

  const rewrittenKey = rewriteProvisioningOptionKey(next['provisioningOptionKey'], map);

  if (rewrittenKey) {
    next['provisioningOptionKey'] = rewrittenKey;
    changed = true;
  }

  const rawOptions = next['provisioningOptions'];

  if (Array.isArray(rawOptions)) {
    let optionsChanged = false;
    const rewrittenOptions = rawOptions.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }

      const option = entry as Record<string, unknown>;

      if (option['type'] !== 'integrated') {
        return entry;
      }

      const rewritten = rewriteServiceId(option['service'], map);

      if (!rewritten) {
        return entry;
      }

      optionsChanged = true;

      return { ...option, service: rewritten };
    });

    if (optionsChanged) {
      next['provisioningOptions'] = rewrittenOptions;
      changed = true;
    }
  }

  return { changed, config: next };
}

/**
 * Rewrites service.enum and productServices arrays inside a service-type config_schema jsonb document.
 */
function rewriteConfigSchemaServiceIds(
  schema: Record<string, unknown>,
  direction: 'toCanonical' | 'toLegacy',
): { changed: boolean; schema: Record<string, unknown> } {
  const map = direction === 'toCanonical' ? LEGACY_TO_CANONICAL : CANONICAL_TO_LEGACY;
  let changed = false;
  const next: Record<string, unknown> = { ...schema };
  const properties = next['properties'];

  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return { changed: false, schema };
  }

  const nextProperties: Record<string, unknown> = { ...(properties as Record<string, unknown>) };

  for (const [key, rawProp] of Object.entries(nextProperties)) {
    if (!rawProp || typeof rawProp !== 'object' || Array.isArray(rawProp)) {
      continue;
    }

    const prop = { ...(rawProp as Record<string, unknown>) };
    let propChanged = false;
    const enumRewrite = rewriteServiceIdList(prop['enum'], map);

    if (enumRewrite.changed) {
      prop['enum'] = enumRewrite.values;
      propChanged = true;
    }

    const productServicesRewrite = rewriteServiceIdList(prop['productServices'], map);

    if (productServicesRewrite.changed) {
      prop['productServices'] = productServicesRewrite.values;
      propChanged = true;
    }

    if (propChanged) {
      nextProperties[key] = prop;
      changed = true;
    }
  }

  if (changed) {
    next['properties'] = nextProperties;
  }

  return { changed, schema: next };
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (raw == null || raw === '') {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface PlanRow {
  id: string;
  provider_config_defaults: Record<string, unknown> | null;
}

interface ServiceTypeRow {
  id: string;
  config_schema: Record<string, unknown> | null;
}

interface EncryptedSnapshotRow {
  id: string;
  snapshot: string | null;
}

/**
 * Renames integrated provisioning service ids:
 * controller → agenstra-controller, manager → agenstra-manager
 * in plan defaults, service-type config schemas, and encrypted subscription/backorder snapshots.
 */
export class RenameIntegratedProvisioningServiceIds1775500000000 implements MigrationInterface {
  name = 'RenameIntegratedProvisioningServiceIds1775500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.rewritePlans(queryRunner, 'toCanonical');
    await this.rewriteServiceTypeSchemas(queryRunner, 'toCanonical');
    await this.rewriteEncryptedSnapshots(queryRunner, 'billing_subscription_items', 'config_snapshot', 'toCanonical');
    await this.rewriteEncryptedSnapshots(queryRunner, 'billing_backorders', 'requested_config_snapshot', 'toCanonical');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.rewritePlans(queryRunner, 'toLegacy');
    await this.rewriteServiceTypeSchemas(queryRunner, 'toLegacy');
    await this.rewriteEncryptedSnapshots(queryRunner, 'billing_subscription_items', 'config_snapshot', 'toLegacy');
    await this.rewriteEncryptedSnapshots(queryRunner, 'billing_backorders', 'requested_config_snapshot', 'toLegacy');
  }

  private async rewritePlans(queryRunner: QueryRunner, direction: 'toCanonical' | 'toLegacy'): Promise<void> {
    const result = await queryRunner.query(
      `SELECT id, provider_config_defaults FROM billing_service_plans WHERE provider_config_defaults IS NOT NULL`,
    );
    const rows = getRows<PlanRow>(result);

    for (const row of rows) {
      if (!row.provider_config_defaults || typeof row.provider_config_defaults !== 'object') {
        continue;
      }

      const { changed, config } = rewriteIntegratedServiceIdsInConfig(row.provider_config_defaults, direction);

      if (!changed) {
        continue;
      }

      await queryRunner.query(`UPDATE billing_service_plans SET provider_config_defaults = $1::jsonb WHERE id = $2`, [
        JSON.stringify(config),
        row.id,
      ]);
    }
  }

  private async rewriteServiceTypeSchemas(
    queryRunner: QueryRunner,
    direction: 'toCanonical' | 'toLegacy',
  ): Promise<void> {
    const result = await queryRunner.query(
      `SELECT id, config_schema FROM billing_service_types WHERE config_schema IS NOT NULL`,
    );
    const rows = getRows<ServiceTypeRow>(result);

    for (const row of rows) {
      if (!row.config_schema || typeof row.config_schema !== 'object') {
        continue;
      }

      const { changed, schema } = rewriteConfigSchemaServiceIds(row.config_schema, direction);

      if (!changed) {
        continue;
      }

      await queryRunner.query(`UPDATE billing_service_types SET config_schema = $1::jsonb WHERE id = $2`, [
        JSON.stringify(schema),
        row.id,
      ]);
    }
  }

  private async rewriteEncryptedSnapshots(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    direction: 'toCanonical' | 'toLegacy',
  ): Promise<void> {
    const gcm = createAes256GcmTransformer();
    const result = await queryRunner.query(
      `SELECT id, ${column} AS snapshot FROM ${table} WHERE ${column} IS NOT NULL`,
    );
    const rows = getRows<EncryptedSnapshotRow>(result);

    for (const row of rows) {
      const decrypted = gcm.from(row.snapshot);
      const parsed = parseJsonObject(decrypted);

      if (!parsed) {
        continue;
      }

      const { changed, config } = rewriteIntegratedServiceIdsInConfig(parsed, direction);

      if (!changed) {
        continue;
      }

      const encrypted = gcm.to(JSON.stringify(config));

      await queryRunner.query(`UPDATE ${table} SET ${column} = $1 WHERE id = $2`, [encrypted, row.id]);
    }
  }
}
