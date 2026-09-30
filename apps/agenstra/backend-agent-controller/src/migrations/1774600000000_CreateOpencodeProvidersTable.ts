import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Cached models.dev OpenCode provider catalog.
 */
export class CreateOpencodeProvidersTable1774600000000 implements MigrationInterface {
  name = 'CreateOpencodeProvidersTable1774600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'opencode_providers',
        columns: [
          { name: 'id', type: 'varchar', length: '128', isPrimary: true },
          { name: 'name', type: 'varchar', length: '256', isNullable: false },
          { name: 'env', type: 'jsonb', isNullable: false, default: "'[]'::jsonb" },
          { name: 'npm', type: 'varchar', length: '256', isNullable: true },
          { name: 'api', type: 'varchar', length: '512', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'opencode_providers',
      new TableIndex({
        name: 'IDX_opencode_providers_name',
        columnNames: ['name'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('opencode_providers', true);
  }
}
