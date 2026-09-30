import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Raw JSON overrides per OpenCode config layer (merged over structured `config`).
 */
export class AddOpencodeConfigOverridesColumns1774900000000 implements MigrationInterface {
  name = 'AddOpencodeConfigOverridesColumns1774900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'global_opencode_config',
      new TableColumn({
        name: 'overrides',
        type: 'jsonb',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'client_opencode_config',
      new TableColumn({
        name: 'overrides',
        type: 'jsonb',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('client_opencode_config', 'overrides');
    await queryRunner.dropColumn('global_opencode_config', 'overrides');
  }
}
