import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Per-agent raw OpenCode JSON overrides (merged over `opencode_user_config`).
 */
export class AddOpencodeUserOverridesToAgentsTable1782300000000 implements MigrationInterface {
  name = 'AddOpencodeUserOverridesToAgentsTable1782300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'opencode_user_overrides',
        type: 'jsonb',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('agents', 'opencode_user_overrides');
  }
}
