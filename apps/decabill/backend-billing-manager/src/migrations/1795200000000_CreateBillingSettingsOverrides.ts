import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Console overrides of billing manager settings (Administration → Settings).
 * `scope_key` is `__global__` (all tenants) or a tenant id; `value` is AES-256-GCM encrypted by the entity
 * transformer. Deleting a row lets the next layer (all tenants, then the environment variable) apply again.
 */
export class CreateBillingSettingsOverrides1795200000000 implements MigrationInterface {
  name = 'CreateBillingSettingsOverrides1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_settings_overrides" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "scope_key" VARCHAR(64) NOT NULL,
        "setting_key" VARCHAR(128) NOT NULL,
        "value" TEXT NOT NULL,
        "updated_by_user_id" UUID NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_settings_overrides_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_billing_settings_overrides_scope_key_setting_key" UNIQUE ("scope_key", "setting_key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_settings_overrides"`);
  }
}
