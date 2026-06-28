import { MigrationInterface, QueryRunner } from 'typeorm';

interface ServicePlanMigrationRow {
  id: string;
  provider_config_defaults: Record<string, unknown> | null;
}

type IntegratedProvisioningService = 'controller' | 'manager';

type PlanProvisioningOption =
  | { type: 'integrated'; service: IntegratedProvisioningService }
  | { type: 'custom'; cloudInitConfigId: string };

const INTEGRATED_SERVICES = new Set<IntegratedProvisioningService>(['controller', 'manager']);

function encodeProvisioningOptionKey(option: PlanProvisioningOption): string {
  if (option.type === 'integrated') {
    return `integrated:${option.service}`;
  }

  return `custom:${option.cloudInitConfigId}`;
}

function parseProvisioningOptionEntry(value: unknown): PlanProvisioningOption | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const type = entry['type'];

  if (type === 'integrated') {
    const service = entry['service'];

    if (typeof service === 'string' && INTEGRATED_SERVICES.has(service as IntegratedProvisioningService)) {
      return { type: 'integrated', service: service as IntegratedProvisioningService };
    }

    return null;
  }

  if (type === 'custom') {
    const cloudInitConfigId = entry['cloudInitConfigId'];

    if (typeof cloudInitConfigId === 'string' && cloudInitConfigId.trim()) {
      return { type: 'custom', cloudInitConfigId: cloudInitConfigId.trim() };
    }

    return null;
  }

  return null;
}

function dedupeOptions(options: PlanProvisioningOption[]): PlanProvisioningOption[] {
  const seen = new Set<string>();
  const result: PlanProvisioningOption[] = [];

  for (const option of options) {
    const key = encodeProvisioningOptionKey(option);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(option);
  }

  return result;
}

function parsePlanProvisioningOptions(
  providerConfigDefaults: Record<string, unknown> | undefined,
): PlanProvisioningOption[] {
  if (!providerConfigDefaults) {
    return [];
  }

  const rawOptions = providerConfigDefaults['provisioningOptions'];

  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return [];
  }

  const parsed = rawOptions
    .map((entry) => parseProvisioningOptionEntry(entry))
    .filter((entry): entry is PlanProvisioningOption => entry !== null);

  return dedupeOptions(parsed);
}

function collectLegacyCustomProvisioningOptions(
  providerConfigDefaults: Record<string, unknown>,
): PlanProvisioningOption[] {
  const options: PlanProvisioningOption[] = [];
  const legacyIds = providerConfigDefaults['cloudInitConfigIds'];

  if (Array.isArray(legacyIds)) {
    for (const id of legacyIds) {
      if (typeof id === 'string' && id.trim()) {
        options.push({ type: 'custom', cloudInitConfigId: id.trim() });
      }
    }
  }

  if (providerConfigDefaults['service'] === 'custom') {
    const cloudInitConfigId = providerConfigDefaults['cloudInitConfigId'];

    if (typeof cloudInitConfigId === 'string' && cloudInitConfigId.trim()) {
      options.push({ type: 'custom', cloudInitConfigId: cloudInitConfigId.trim() });
    }
  }

  return dedupeOptions(options);
}

function inferLegacyPlanProvisioningOptions(
  providerConfigDefaults: Record<string, unknown> | undefined,
): PlanProvisioningOption[] {
  if (!providerConfigDefaults) {
    return [];
  }

  const legacyService = providerConfigDefaults['service'];

  if (legacyService === 'manager' || legacyService === 'controller') {
    return [{ type: 'integrated', service: legacyService as IntegratedProvisioningService }];
  }

  const customOptions = collectLegacyCustomProvisioningOptions(providerConfigDefaults);

  if (customOptions.length > 0) {
    return customOptions;
  }

  if (legacyService === 'custom') {
    return [];
  }

  return [{ type: 'integrated', service: 'controller' }];
}

function hasBothIntegratedOptions(options: PlanProvisioningOption[]): boolean {
  const integrated = options.filter(
    (option): option is Extract<PlanProvisioningOption, { type: 'integrated' }> => option.type === 'integrated',
  );

  return (
    integrated.some((option) => option.service === 'controller') &&
    integrated.some((option) => option.service === 'manager')
  );
}

function applyProvisioningOptionsToDefaults(
  providerConfigDefaults: Record<string, unknown>,
  options: PlanProvisioningOption[],
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...providerConfigDefaults };

  if (options.length === 0) {
    delete normalized['provisioningOptions'];
    delete normalized['service'];
    delete normalized['cloudInitConfigId'];
    delete normalized['cloudInitConfigIds'];

    return normalized;
  }

  normalized['provisioningOptions'] = options;

  if (options.length === 1) {
    const only = options[0];

    if (only.type === 'integrated') {
      normalized['service'] = only.service;
      delete normalized['cloudInitConfigId'];
    } else {
      normalized['service'] = 'custom';
      normalized['cloudInitConfigId'] = only.cloudInitConfigId;
    }

    delete normalized['cloudInitConfigIds'];
  } else {
    delete normalized['service'];
    delete normalized['cloudInitConfigId'];
    delete normalized['cloudInitConfigIds'];
  }

  return normalized;
}

function correctOverBackfilledProvisioningOptions(
  providerConfigDefaults: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!providerConfigDefaults) {
    return undefined;
  }

  const options = parsePlanProvisioningOptions(providerConfigDefaults);

  if (options.length === 0) {
    return undefined;
  }

  const legacyService = providerConfigDefaults['service'];
  const customOptions = options.filter(
    (option): option is Extract<PlanProvisioningOption, { type: 'custom' }> => option.type === 'custom',
  );
  const bothIntegrated = hasBothIntegratedOptions(options);

  if (bothIntegrated && customOptions.length > 0) {
    return applyProvisioningOptionsToDefaults(
      { ...providerConfigDefaults, provisioningOptions: customOptions },
      customOptions,
    );
  }

  if (bothIntegrated && customOptions.length === 0 && options.length === 2) {
    const resolvedService: IntegratedProvisioningService =
      legacyService === 'manager' || legacyService === 'controller' ? legacyService : 'controller';
    const singleOption: PlanProvisioningOption[] = [{ type: 'integrated', service: resolvedService }];

    return applyProvisioningOptionsToDefaults(
      { ...providerConfigDefaults, provisioningOptions: singleOption },
      singleOption,
    );
  }

  return undefined;
}

function reconcilePlanProviderConfigDefaults(
  providerConfigDefaults: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!providerConfigDefaults) {
    return undefined;
  }

  let working: Record<string, unknown> = { ...providerConfigDefaults };
  let options = parsePlanProvisioningOptions(working);

  if (options.length === 0) {
    options = inferLegacyPlanProvisioningOptions(working);

    if (options.length > 0) {
      working = { ...working, provisioningOptions: options };
    }
  } else {
    const corrected = correctOverBackfilledProvisioningOptions(working);

    if (corrected) {
      return corrected;
    }
  }

  return applyProvisioningOptionsToDefaults(working, options);
}

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  const withRows = result as { rows?: unknown[] };

  return (withRows.rows ?? []) as T[];
}

function defaultsChanged(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/**
 * Consolidated, idempotent CloudInit schema + plan provisioning repair.
 * Safe on fresh databases and on databases that already ran earlier split migrations.
 */
export class CloudInitAndPlanProvisioningConsolidated1772000000000 implements MigrationInterface {
  name = 'CloudInitAndPlanProvisioningConsolidated1772000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_cloud_init_configs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" varchar(64) NOT NULL DEFAULT 'default',
        "key" varchar(100) NOT NULL,
        "name" varchar(255) NOT NULL,
        "description" text,
        "docker_image" varchar(512),
        "container_port" int NOT NULL DEFAULT 8080,
        "host_port" int NOT NULL DEFAULT 80,
        "work_dir" varchar(255) NOT NULL DEFAULT '/opt/custom-app',
        "environment_variables" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "env_default_values" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_cloud_init_configs" PRIMARY KEY ("id"),
        CONSTRAINT "uq_billing_cloud_init_configs_tenant_key" UNIQUE ("tenant_id", "key")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_cloud_init_configs_tenant_id"
      ON "billing_cloud_init_configs" ("tenant_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_cloud_init_configs"
      ADD COLUMN IF NOT EXISTS "provisioning_mode" varchar(32) NOT NULL DEFAULT 'simple'
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_cloud_init_configs"
      ADD COLUMN IF NOT EXISTS "docker_compose_template" text
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_cloud_init_configs"
      ADD COLUMN IF NOT EXISTS "user_data_template" text
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_cloud_init_configs"
      ALTER COLUMN "docker_image" DROP NOT NULL
    `);

    const result = await queryRunner.query(`
      SELECT sp.id, sp.provider_config_defaults
      FROM billing_service_plans sp
      INNER JOIN billing_service_types st ON st.id = sp.service_type_id
      WHERE st.provider IN ('hetzner', 'digital-ocean')
    `);

    for (const row of getRows<ServicePlanMigrationRow>(result)) {
      const defaults = row.provider_config_defaults ?? {};
      const reconciled = reconcilePlanProviderConfigDefaults(defaults);

      if (!reconciled || !defaultsChanged(defaults, reconciled)) {
        continue;
      }

      await queryRunner.query(`UPDATE billing_service_plans SET provider_config_defaults = $1::jsonb WHERE id = $2`, [
        JSON.stringify(reconciled),
        row.id,
      ]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_cloud_init_configs_tenant_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_cloud_init_configs"`);
  }
}
