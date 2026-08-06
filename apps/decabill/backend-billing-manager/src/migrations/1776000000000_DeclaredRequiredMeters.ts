import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeclaredRequiredMeters1776000000000 implements MigrationInterface {
  name = 'DeclaredRequiredMeters1776000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_service_plan_meters"
      ADD COLUMN IF NOT EXISTS "source" character varying(16) NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS "required" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_addon_meters"
      ADD COLUMN IF NOT EXISTS "source" character varying(16) NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS "required" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_service_type_meters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "service_type_id" uuid NOT NULL,
        "meter_id" uuid NOT NULL,
        "unit_price_net" numeric(12,4),
        "source" character varying(16) NOT NULL DEFAULT 'manual',
        "required" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_service_type_meters" PRIMARY KEY ("id"),
        CONSTRAINT "uq_billing_service_type_meters_type_meter" UNIQUE ("service_type_id", "meter_id"),
        CONSTRAINT "FK_billing_service_type_meters_type"
          FOREIGN KEY ("service_type_id") REFERENCES "billing_service_types"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_service_type_meters_meter"
          FOREIGN KEY ("meter_id") REFERENCES "billing_meters"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_service_type_meters_type"
      ON "billing_service_type_meters" ("service_type_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_service_type_meters_type"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_service_type_meters"`);
    await queryRunner.query(`
      ALTER TABLE "billing_addon_meters"
      DROP COLUMN IF EXISTS "required",
      DROP COLUMN IF EXISTS "source"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_service_plan_meters"
      DROP COLUMN IF EXISTS "required",
      DROP COLUMN IF EXISTS "source"
    `);
  }
}
