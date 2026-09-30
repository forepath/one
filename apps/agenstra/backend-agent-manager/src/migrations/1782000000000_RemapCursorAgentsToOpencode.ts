import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remap Cursor runtime agents to OpenCode and clear ACP session state.
 * Cursor ACP session ids are not loadable by OpenCode.
 */
export class RemapCursorAgentsToOpencode1782000000000 implements MigrationInterface {
  name = 'RemapCursorAgentsToOpencode1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "agents"
      SET "agent_type" = 'opencode',
          "acp_sessions" = NULL
      WHERE "agent_type" = 'cursor'
    `);

    await queryRunner.query(`
      ALTER TABLE "agents"
      ALTER COLUMN "agent_type" SET DEFAULT 'opencode'
    `);

    await queryRunner.query(`
      DELETE FROM "workspace_configuration_overrides"
      WHERE "setting_key" = 'cursorApiKey'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agents"
      ALTER COLUMN "agent_type" SET DEFAULT 'cursor'
    `);
  }
}
