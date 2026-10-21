import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Task runs are unattended and allow-all, so tasks need a user's approval before they run:
 * - `approved_at` / `approved_by_user_id`; tasks created by users count as approved, agent-created tasks wait
 * - at most one running run per task (partial unique index)
 */
export class AddAgentTaskApproval1792700000000 implements MigrationInterface {
  name = 'AddAgentTaskApproval1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_tasks" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "agent_tasks" ADD COLUMN IF NOT EXISTS "approved_by_user_id" uuid`);
    await queryRunner.query(`
      UPDATE "agent_tasks"
      SET "approved_at" = "created_at", "approved_by_user_id" = "created_by_user_id"
      WHERE "created_by_type" = 'user' AND "updated_by_type" = 'user' AND "approved_at" IS NULL
    `);
    // Earlier duplicates (concurrent manual runs) would block the index; keep the newest running run.
    await queryRunner.query(`
      UPDATE "agent_task_runs" r
      SET "status" = 'failed', "finished_at" = now(), "failure_message" = 'Superseded by a concurrent run.'
      WHERE r."status" = 'running'
        AND EXISTS (
          SELECT 1 FROM "agent_task_runs" o
          WHERE o."task_id" = r."task_id" AND o."status" = 'running' AND o."started_at" > r."started_at"
        )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_task_runs_one_running" ON "agent_task_runs" ("task_id") WHERE "status" = 'running'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_agent_task_runs_one_running"`);
    await queryRunner.query(`ALTER TABLE "agent_tasks" DROP COLUMN IF EXISTS "approved_by_user_id"`);
    await queryRunner.query(`ALTER TABLE "agent_tasks" DROP COLUMN IF EXISTS "approved_at"`);
  }
}
