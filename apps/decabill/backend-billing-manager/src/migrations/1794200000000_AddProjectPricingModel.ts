import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Project pricing models: `hourly` (default, previous behaviour), `capped` (hourly up to a maximum price) and
 * `fixed` (fixed price). `price_limit_net` holds the maximum / fixed price; `billed_amount_net` tracks the cumulative
 * net amount invoiced for project time and is backfilled from already billed time entries × hourly rate.
 */
export class AddProjectPricingModel1794200000000 implements MigrationInterface {
  name = 'AddProjectPricingModel1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "project_pricing_model_enum" AS ENUM ('hourly', 'capped', 'fixed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_projects"
      ADD COLUMN IF NOT EXISTS "pricing_model" "project_pricing_model_enum" NOT NULL DEFAULT 'hourly',
      ADD COLUMN IF NOT EXISTS "price_limit_net" numeric(12,4) NULL,
      ADD COLUMN IF NOT EXISTS "billed_amount_net" numeric(12,4) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE "billing_projects" p
      SET "billed_amount_net" = ROUND(billed.minutes / 60.0 * p."hourly_rate_net", 4)
      FROM (
        SELECT "project_id", SUM("duration_minutes") AS minutes
        FROM "billing_project_time_entries"
        WHERE "billed_at" IS NOT NULL
        GROUP BY "project_id"
      ) billed
      WHERE billed."project_id" = p."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_projects"
      DROP COLUMN IF EXISTS "billed_amount_net",
      DROP COLUMN IF EXISTS "price_limit_net",
      DROP COLUMN IF EXISTS "pricing_model"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "project_pricing_model_enum"`);
  }
}
