import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat events of each agent task run (session history on the `/tasks` page).
 */
export class AddAgentTaskRunTranscript1792500000000 implements MigrationInterface {
  name = 'AddAgentTaskRunTranscript1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_task_runs" ADD COLUMN IF NOT EXISTS "transcript" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_task_runs" DROP COLUMN IF EXISTS "transcript"`);
  }
}
