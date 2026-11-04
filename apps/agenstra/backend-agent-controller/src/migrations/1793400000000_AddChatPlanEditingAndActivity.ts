import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plans page (`/plans/:clientId`): workspace users edit plans that have not been executed yet, with an activity log.
 * - `chat_plan.execution_started_at`: first entry into `executing`; once set the plan is read-only for good
 * - `chat_plan.last_edited_at` / `last_edited_by_user_id`: last user edit (the execute prompt marks user edits)
 * - `chat_plan_activity`: per-plan activity log (creation, agent drafts, user edits, execution, cancel / failure)
 */
export class AddChatPlanEditingAndActivity1793400000000 implements MigrationInterface {
  name = 'AddChatPlanEditingAndActivity1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_plan" ADD COLUMN IF NOT EXISTS "execution_started_at" TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE "chat_plan" ADD COLUMN IF NOT EXISTS "last_edited_at" TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE "chat_plan" ADD COLUMN IF NOT EXISTS "last_edited_by_user_id" UUID NULL`);

    // Existing plans that ran (or failed while running) stay read-only.
    await queryRunner.query(`
      UPDATE "chat_plan"
      SET "execution_started_at" = COALESCE("finished_at", "updated_at")
      WHERE "execution_started_at" IS NULL
        AND (
          "status" IN ('executing', 'executed')
          OR ("status" = 'failed' AND "failure_message" = 'Plan execute turn failed')
        )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_plan_activity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "plan_id" uuid NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "actor_type" varchar(16) NOT NULL,
        "actor_user_id" uuid NULL,
        "action_type" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "PK_chat_plan_activity_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_plan_activity_plan_id" FOREIGN KEY ("plan_id") REFERENCES "chat_plan"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_plan_activity_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_plan_activity_plan_occurred" ON "chat_plan_activity" ("plan_id", "occurred_at")`,
    );
    // Plans page: newest first per agent.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_plan_client_agent_started" ON "chat_plan" ("client_id", "agent_id", "started_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_plan_client_agent_started"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_plan_activity_plan_occurred"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_plan_activity"`);
    await queryRunner.query(`ALTER TABLE "chat_plan" DROP COLUMN IF EXISTS "last_edited_by_user_id"`);
    await queryRunner.query(`ALTER TABLE "chat_plan" DROP COLUMN IF EXISTS "last_edited_at"`);
    await queryRunner.query(`ALTER TABLE "chat_plan" DROP COLUMN IF EXISTS "execution_started_at"`);
  }
}
