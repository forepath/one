import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Durable per-agent OpenCode effective-config sync targets (retry pending/failed).
 */
export class CreateOpencodeConfigSyncTargetsTable1774800000000 implements MigrationInterface {
  name = 'CreateOpencodeConfigSyncTargetsTable1774800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'opencode_config_sync_targets',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'agent_id', type: 'uuid', isNullable: false },
          { name: 'desired_revision', type: 'varchar', length: '64', isNullable: false },
          { name: 'applied_revision', type: 'varchar', length: '64', isNullable: true },
          { name: 'sync_status', type: 'varchar', length: '16', default: "'pending'", isNullable: false },
          { name: 'last_error', type: 'text', isNullable: true },
          { name: 'last_synced_at', type: 'timestamp', isNullable: true },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'opencode_config_sync_targets',
      new TableIndex({
        name: 'IDX_opencode_config_sync_agent',
        columnNames: ['agent_id'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'opencode_config_sync_targets',
      new TableIndex({
        name: 'IDX_opencode_config_sync_status',
        columnNames: ['sync_status', 'updated_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('opencode_config_sync_targets', true);
  }
}
