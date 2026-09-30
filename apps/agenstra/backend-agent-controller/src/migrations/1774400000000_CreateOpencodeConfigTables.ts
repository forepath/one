import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Create global_opencode_config and client_opencode_config tables.
 */
export class CreateOpencodeConfigTables1774400000000 implements MigrationInterface {
  name = 'CreateOpencodeConfigTables1774400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'global_opencode_config',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'config', type: 'jsonb', isNullable: true },
          { name: 'secrets', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'client_opencode_config',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'config', type: 'jsonb', isNullable: true },
          { name: 'secrets', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'client_opencode_config',
      new TableIndex({
        name: 'IDX_client_opencode_config_client_id',
        columnNames: ['client_id'],
        isUnique: true,
      }),
    );

    await queryRunner.createForeignKey(
      'client_opencode_config',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('client_opencode_config', true);
    await queryRunner.dropTable('global_opencode_config', true);
  }
}
