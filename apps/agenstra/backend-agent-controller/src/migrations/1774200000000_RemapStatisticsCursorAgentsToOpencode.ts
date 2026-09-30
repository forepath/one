import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remap Cursor agent_type values in statistics shadow tables to OpenCode.
 */
export class RemapStatisticsCursorAgentsToOpencode1774200000000 implements MigrationInterface {
  name = 'RemapStatisticsCursorAgentsToOpencode1774200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "statistics_agents"
      SET "agent_type" = 'opencode'
      WHERE "agent_type" = 'cursor'
    `);

    await queryRunner.query(`
      ALTER TABLE "statistics_agents"
      ALTER COLUMN "agent_type" SET DEFAULT 'opencode'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "statistics_agents"
      ALTER COLUMN "agent_type" SET DEFAULT 'cursor'
    `);
  }
}
