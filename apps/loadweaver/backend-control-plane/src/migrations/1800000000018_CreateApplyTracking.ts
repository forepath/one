import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateApplyTracking1800000000018 implements MigrationInterface {
  name = 'CreateApplyTracking1800000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Per-resource-scope locks (3.8): held by a plan while it is applied, or while a failed rollback is unresolved.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_resource_locks" (
        "scope" varchar(255) PRIMARY KEY,
        "plan_id" uuid NOT NULL,
        "acquired_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_resource_locks_plan" ON "lw_resource_locks" ("plan_id")`,
    );
    // Applies as tracked operations (3.19): progress, cancel, rollback data, the plan a fix-forward resolves.
    for (const column of [
      `"progress" jsonb`,
      `"cancel_requested" boolean NOT NULL DEFAULT false`,
      `"resolves" uuid`,
      `"rollback" jsonb`,
      `"tracker_heartbeat_at" TIMESTAMPTZ`,
      `"tracker_owner" varchar(64)`,
      `"updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()`,
    ])
      await queryRunner.query(`ALTER TABLE "lw_plans" ADD COLUMN IF NOT EXISTS ${column}`);
    await queryRunner.query(`ALTER TABLE "lw_plans" ALTER COLUMN "status" TYPE varchar(20)`);
    // What the nodes report: connection, the revision and steps of the last apply report, foreign containers (drift).
    for (const column of [
      `"connected" boolean NOT NULL DEFAULT false`,
      `"last_report_revision" integer`,
      `"last_report_steps" jsonb`,
      `"drift" jsonb`,
    ])
      await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS ${column}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['drift', 'last_report_steps', 'last_report_revision', 'connected'])
      await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "${column}"`);
    for (const column of [
      'updated_at',
      'tracker_owner',
      'tracker_heartbeat_at',
      'rollback',
      'resolves',
      'cancel_requested',
      'progress',
    ])
      await queryRunner.query(`ALTER TABLE "lw_plans" DROP COLUMN IF EXISTS "${column}"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_resource_locks"`);
  }
}
