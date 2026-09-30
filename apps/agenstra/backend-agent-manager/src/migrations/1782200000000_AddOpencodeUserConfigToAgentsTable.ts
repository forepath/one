import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Per-agent OpenCode user config + GCM-encrypted secrets.
 */
export class AddOpencodeUserConfigToAgentsTable1782200000000 implements MigrationInterface {
  name = 'AddOpencodeUserConfigToAgentsTable1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'opencode_user_config',
        type: 'jsonb',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'opencode_user_secrets',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('agents', 'opencode_user_secrets');
    await queryRunner.dropColumn('agents', 'opencode_user_config');
  }
}
