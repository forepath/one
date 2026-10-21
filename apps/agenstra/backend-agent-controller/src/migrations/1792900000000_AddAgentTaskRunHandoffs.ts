import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Handoffs from scheduled task runs:
 * - `agent_tasks.allowed_handoff_agent_ids`: approved peer agents the runs may hand off to (empty: none)
 * - `agent_task_runs.awaiting_handoff_since` / `turn_started_at`: a run waiting for a handoff response
 *   (`awaiting_handoff`, still one active run per task) and the start of its current turn (stale detection)
 * - `agent_handoffs.source_task_id` / `source_task_run_id`: handoffs made by a task run have no source chat
 */
export class AddAgentTaskRunHandoffs1792900000000 implements MigrationInterface {
  name = 'AddAgentTaskRunHandoffs1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_tasks" ADD COLUMN IF NOT EXISTS "allowed_handoff_agent_ids" JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_task_runs" ADD COLUMN IF NOT EXISTS "awaiting_handoff_since" TIMESTAMPTZ`,
    );
    await queryRunner.query(`ALTER TABLE "agent_task_runs" ADD COLUMN IF NOT EXISTS "turn_started_at" TIMESTAMPTZ`);
    // A waiting run still occupies its task.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_agent_task_runs_one_running"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_task_runs_one_running" ON "agent_task_runs" ("task_id") WHERE "status" IN ('running', 'awaiting_handoff')`,
    );
    await queryRunner.query(`ALTER TABLE "agent_handoffs" ALTER COLUMN "source_chat_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "agent_handoffs" ADD COLUMN IF NOT EXISTS "source_task_id" UUID`);
    await queryRunner.query(`ALTER TABLE "agent_handoffs" ADD COLUMN IF NOT EXISTS "source_task_run_id" UUID`);
    await queryRunner.query(`
      ALTER TABLE "agent_handoffs" ADD CONSTRAINT "CHK_agent_handoffs_one_source" CHECK (
        ("source_chat_id" IS NOT NULL AND "source_task_id" IS NULL AND "source_task_run_id" IS NULL)
        OR ("source_chat_id" IS NULL AND "source_task_id" IS NOT NULL AND "source_task_run_id" IS NOT NULL)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_handoffs_source_task_run" ON "agent_handoffs" ("source_task_run_id") WHERE "source_task_run_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_handoffs_source_task_run"`);
    await queryRunner.query(`ALTER TABLE "agent_handoffs" DROP CONSTRAINT IF EXISTS "CHK_agent_handoffs_one_source"`);
    // Task run handoffs have no source chat; they cannot exist in the previous schema.
    await queryRunner.query(`DELETE FROM "agent_handoffs" WHERE "source_chat_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "agent_handoffs" DROP COLUMN IF EXISTS "source_task_run_id"`);
    await queryRunner.query(`ALTER TABLE "agent_handoffs" DROP COLUMN IF EXISTS "source_task_id"`);
    await queryRunner.query(`ALTER TABLE "agent_handoffs" ALTER COLUMN "source_chat_id" SET NOT NULL`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_agent_task_runs_one_running"`);
    await queryRunner.query(
      `UPDATE "agent_task_runs" SET "status" = 'failed', "finished_at" = now(), "failure_message" = 'Interrupted by a schema downgrade.' WHERE "status" = 'awaiting_handoff'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_task_runs_one_running" ON "agent_task_runs" ("task_id") WHERE "status" = 'running'`,
    );
    await queryRunner.query(`ALTER TABLE "agent_task_runs" DROP COLUMN IF EXISTS "turn_started_at"`);
    await queryRunner.query(`ALTER TABLE "agent_task_runs" DROP COLUMN IF EXISTS "awaiting_handoff_since"`);
    await queryRunner.query(`ALTER TABLE "agent_tasks" DROP COLUMN IF EXISTS "allowed_handoff_agent_ids"`);
  }
}
