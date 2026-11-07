import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Environment graphs: one persisted metadata graph per workspace (environments, knowledge, tickets, plans; titles and
 * ids only). The global graph is the union over the workspaces a caller may access.
 */
export class AddWorkspaceGraphSnapshots1794100000000 implements MigrationInterface {
  name = 'AddWorkspaceGraphSnapshots1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'workspace_graph_snapshots',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'status', type: 'varchar', length: '16', isNullable: false },
          { name: 'graph', type: 'jsonb', isNullable: true },
          { name: 'node_count', type: 'int', isNullable: false, default: 0 },
          { name: 'edge_count', type: 'int', isNullable: false, default: 0 },
          { name: 'built_at', type: 'timestamptz', isNullable: true },
          { name: 'error', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'workspace_graph_snapshots',
      new TableIndex({
        name: 'uq_workspace_graph_snapshots_client_id',
        columnNames: ['client_id'],
        isUnique: true,
      }),
    );
    await queryRunner.createForeignKey(
      'workspace_graph_snapshots',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('workspace_graph_snapshots', true, true, true);
  }
}
