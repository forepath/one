import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Cached official MCP Registry server catalog (latest versions).
 */
export class CreateOpencodeMcpServersTable1775100000000 implements MigrationInterface {
  name = 'CreateOpencodeMcpServersTable1775100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'opencode_mcp_servers',
        columns: [
          { name: 'name', type: 'varchar', length: '200', isPrimary: true },
          { name: 'title', type: 'varchar', length: '256', isNullable: false },
          { name: 'description', type: 'varchar', length: '512', isNullable: false },
          { name: 'version', type: 'varchar', length: '255', isNullable: false },
          { name: 'status', type: 'varchar', length: '32', isNullable: false, default: "'active'" },
          { name: 'website_url', type: 'varchar', length: '1024', isNullable: true },
          { name: 'packages', type: 'jsonb', isNullable: false, default: "'[]'::jsonb" },
          { name: 'remotes', type: 'jsonb', isNullable: false, default: "'[]'::jsonb" },
          { name: 'repository', type: 'jsonb', isNullable: true },
          { name: 'published_at', type: 'timestamptz', isNullable: true },
          { name: 'registry_updated_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'opencode_mcp_servers',
      new TableIndex({
        name: 'IDX_opencode_mcp_servers_title',
        columnNames: ['title'],
      }),
    );

    await queryRunner.createIndex(
      'opencode_mcp_servers',
      new TableIndex({
        name: 'IDX_opencode_mcp_servers_status',
        columnNames: ['status'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('opencode_mcp_servers', true);
  }
}
