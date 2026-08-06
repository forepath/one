import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMeterTables1775900000000 implements MigrationInterface {
  name = 'CreateMeterTables1775900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_meters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying(64) NOT NULL DEFAULT 'default',
        "key" character varying(100) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "unit_label" character varying(64),
        "aggregator" character varying(16) NOT NULL,
        "default_unit_price_net" numeric(12,4) NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_meters" PRIMARY KEY ("id"),
        CONSTRAINT "uq_billing_meters_tenant_key" UNIQUE ("tenant_id", "key")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_meters_tenant_active"
      ON "billing_meters" ("tenant_id", "is_active")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_service_plan_meters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "service_plan_id" uuid NOT NULL,
        "meter_id" uuid NOT NULL,
        "unit_price_net" numeric(12,4),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_service_plan_meters" PRIMARY KEY ("id"),
        CONSTRAINT "uq_billing_service_plan_meters_plan_meter" UNIQUE ("service_plan_id", "meter_id"),
        CONSTRAINT "FK_billing_service_plan_meters_plan"
          FOREIGN KEY ("service_plan_id") REFERENCES "billing_service_plans"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_service_plan_meters_meter"
          FOREIGN KEY ("meter_id") REFERENCES "billing_meters"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_service_plan_meters_plan"
      ON "billing_service_plan_meters" ("service_plan_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_addon_meters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "addon_id" uuid NOT NULL,
        "meter_id" uuid NOT NULL,
        "unit_price_net" numeric(12,4),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_addon_meters" PRIMARY KEY ("id"),
        CONSTRAINT "uq_billing_addon_meters_addon_meter" UNIQUE ("addon_id", "meter_id"),
        CONSTRAINT "FK_billing_addon_meters_addon"
          FOREIGN KEY ("addon_id") REFERENCES "billing_addons"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_addon_meters_meter"
          FOREIGN KEY ("meter_id") REFERENCES "billing_meters"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_addon_meters_addon"
      ON "billing_addon_meters" ("addon_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_usage_records"
      ADD COLUMN IF NOT EXISTS "meter_id" uuid,
      ADD COLUMN IF NOT EXISTS "value" numeric(18,6),
      ADD COLUMN IF NOT EXISTS "attachment_type" character varying(16),
      ADD COLUMN IF NOT EXISTS "addon_id" uuid
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_usage_records"
          ADD CONSTRAINT "FK_billing_usage_records_meter"
          FOREIGN KEY ("meter_id") REFERENCES "billing_meters"("id") ON DELETE RESTRICT;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "billing_usage_records"
          ADD CONSTRAINT "FK_billing_usage_records_addon"
          FOREIGN KEY ("addon_id") REFERENCES "billing_addons"("id") ON DELETE RESTRICT;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_usage_records_subscription_meter"
      ON "billing_usage_records" ("subscription_id", "meter_id", "attachment_type")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_usage_records_subscription_meter"`);
    await queryRunner.query(`
      ALTER TABLE "billing_usage_records" DROP CONSTRAINT IF EXISTS "FK_billing_usage_records_addon"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_usage_records" DROP CONSTRAINT IF EXISTS "FK_billing_usage_records_meter"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_usage_records"
        DROP COLUMN IF EXISTS "addon_id",
        DROP COLUMN IF EXISTS "attachment_type",
        DROP COLUMN IF EXISTS "value",
        DROP COLUMN IF EXISTS "meter_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_addon_meters_addon"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_addon_meters"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_service_plan_meters_plan"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_service_plan_meters"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_meters_tenant_active"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_meters"`);
  }
}
