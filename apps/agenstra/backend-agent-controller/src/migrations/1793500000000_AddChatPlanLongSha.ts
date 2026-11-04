import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plans as context (like tickets and knowledge pages): a stable long SHA per plan (sha1 of the plan id) for
 * `plan:<sha>` context refs, chat context selection and the agent's context / content tools.
 */
export class AddChatPlanLongSha1793500000000 implements MigrationInterface {
  name = 'AddChatPlanLongSha1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await queryRunner.query(`ALTER TABLE "chat_plan" ADD COLUMN IF NOT EXISTS "long_sha" varchar(40) NULL`);
    await queryRunner.query(`
      UPDATE "chat_plan"
      SET "long_sha" = encode(digest("id"::text, 'sha1'), 'hex')
      WHERE "long_sha" IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_plan_client_agent_long_sha" ON "chat_plan" ("client_id", "agent_id", "long_sha")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_plan_client_agent_long_sha"`);
    await queryRunner.query(`ALTER TABLE "chat_plan" DROP COLUMN IF EXISTS "long_sha"`);
  }
}
