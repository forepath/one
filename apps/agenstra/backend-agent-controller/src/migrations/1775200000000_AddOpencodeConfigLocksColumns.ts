import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Explicit OpenCode config locks per Global / Workspace layer (JSON Pointer paths).
 */
export class AddOpencodeConfigLocksColumns1775200000000 implements MigrationInterface {
  name = 'AddOpencodeConfigLocksColumns1775200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'global_opencode_config',
      new TableColumn({
        name: 'locks',
        type: 'jsonb',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'client_opencode_config',
      new TableColumn({
        name: 'locks',
        type: 'jsonb',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('client_opencode_config', 'locks');
    await queryRunner.dropColumn('global_opencode_config', 'locks');
  }
}
