import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCronTables1800000000004 implements MigrationInterface {
  name = 'CreateCronTables1800000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_cron_schedules" (
        "id" varchar(192) PRIMARY KEY,
        "last_scheduled_at" TIMESTAMPTZ NOT NULL,
        "sequence" integer NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_cron_runs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "cron" varchar(192) NOT NULL,
        "project" varchar(63) NOT NULL,
        "scheduled_at" TIMESTAMPTZ NOT NULL,
        "attempt" integer NOT NULL DEFAULT 0,
        "workload" varchar(256),
        "node" varchar(63),
        "state" varchar(16) NOT NULL,
        "exit_code" integer,
        "message" varchar(500),
        "started_at" TIMESTAMPTZ,
        "finished_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "UQ_lw_cron_runs_due" UNIQUE ("cron", "scheduled_at", "attempt")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_cron_runs_cron" ON "lw_cron_runs" ("cron", "created_at")`,
    );
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" ADD COLUMN IF NOT EXISTS "cron_run" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" DROP COLUMN IF EXISTS "cron_run"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_cron_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_cron_schedules"`);
  }
}
