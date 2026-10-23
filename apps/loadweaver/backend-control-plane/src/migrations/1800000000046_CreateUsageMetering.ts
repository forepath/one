import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Usage metering per project (3.24, P2): the control plane's allocation samples every 5 minutes (volume sizes,
 * public addresses; retention 7 days) and the hourly billing buckets per project and meter (retention 25 months),
 * recomputed until final and immutable afterwards. `billing_subscription` snapshots the project's Decabill mapping
 * (`spec.billing.decabillSubscriptionId`) when the bucket was computed, so remapping or deleting a project never
 * moves usage that was already billed.
 */
export class CreateUsageMetering1800000000046 implements MigrationInterface {
  name = 'CreateUsageMetering1800000000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_usage_samples" (
        "time" timestamptz NOT NULL,
        "project" varchar(63) NOT NULL,
        "input" varchar(32) NOT NULL,
        "value" double precision NOT NULL,
        CONSTRAINT "PK_lw_usage_samples" PRIMARY KEY ("time", "project", "input")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_usage_1h" (
        "bucket" timestamptz NOT NULL,
        "project" varchar(63) NOT NULL,
        "meter" varchar(32) NOT NULL,
        "value" double precision NOT NULL CHECK ("value" >= 0),
        "final" boolean NOT NULL DEFAULT false,
        "billing_subscription" varchar(64),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_usage_1h" PRIMARY KEY ("project", "meter", "bucket")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_usage_1h_bucket" ON "lw_usage_1h" ("bucket")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_usage_1h_billing" ON "lw_usage_1h" ("billing_subscription", "bucket") WHERE "billing_subscription" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_usage_1h_open" ON "lw_usage_1h" ("bucket") WHERE NOT "final"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_usage_1h"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_usage_samples"`);
  }
}
