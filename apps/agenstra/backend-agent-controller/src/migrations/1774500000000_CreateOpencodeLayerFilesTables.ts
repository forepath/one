import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Layer virtual FS: store global/workspace OpenCode path file bodies and per-agent sync targets.
 */
export class CreateOpencodeLayerFilesTables1774500000000 implements MigrationInterface {
  name = 'CreateOpencodeLayerFilesTables1774500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'opencode_layer_files',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'scope', type: 'varchar', length: '16', isNullable: false },
          { name: 'client_id', type: 'uuid', isNullable: true },
          { name: 'path', type: 'varchar', length: '1024', isNullable: false },
          { name: 'entry_kind', type: 'varchar', length: '16', default: "'file'", isNullable: false },
          { name: 'content', type: 'text', isNullable: true },
          { name: 'content_sha', type: 'varchar', length: '64', isNullable: false },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'opencode_layer_files',
      new TableIndex({
        name: 'IDX_opencode_layer_files_scope_client_path',
        columnNames: ['scope', 'client_id', 'path'],
        isUnique: true,
      }),
    );

    await queryRunner.createForeignKey(
      'opencode_layer_files',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'opencode_layer_file_sync_targets',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'file_id', type: 'uuid', isNullable: false },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'agent_id', type: 'uuid', isNullable: false },
          { name: 'sync_status', type: 'varchar', length: '16', default: "'pending'", isNullable: false },
          { name: 'last_error', type: 'text', isNullable: true },
          { name: 'synced_sha', type: 'varchar', length: '64', isNullable: true },
          { name: 'last_synced_at', type: 'timestamp', isNullable: true },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'opencode_layer_file_sync_targets',
      new TableForeignKey({
        columnNames: ['file_id'],
        referencedTableName: 'opencode_layer_files',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'opencode_layer_file_sync_targets',
      new TableIndex({
        name: 'IDX_opencode_layer_file_sync_file_agent',
        columnNames: ['file_id', 'agent_id'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('opencode_layer_file_sync_targets', true);
    await queryRunner.dropTable('opencode_layer_files', true);
  }
}
