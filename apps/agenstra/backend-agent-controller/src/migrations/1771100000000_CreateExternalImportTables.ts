import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * External import tables for Atlassian (Jira/Confluence).
 *
 * **api_token (atlassian_site_connections):** The database never stores the raw API token. Values are
 * written and read through TypeORM using AES-256-GCM (`createAes256GcmTransformer` from
 * `@forepath/shared/backend`), same format as other encrypted columns (iv:tag:ciphertext, base64).
 * The column is `text` so ciphertext is never truncated (plaintext input is capped in DTOs).
 */
export class CreateExternalImportTables1771100000000 implements MigrationInterface {
  name = 'CreateExternalImportTables1771100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'atlassian_site_connections',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'label', type: 'varchar', length: '200', isNullable: true },
          {
            name: 'base_url',
            type: 'varchar',
            length: '512',
            isNullable: false,
          },
          {
            name: 'account_email',
            type: 'varchar',
            length: '320',
            isNullable: false,
          },
          {
            name: 'api_token',
            type: 'text',
            isNullable: false,
          },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'external_import_configs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'provider',
            type: 'varchar',
            length: '32',
            isNullable: false,
          },
          {
            name: 'import_kind',
            type: 'varchar',
            length: '32',
            isNullable: false,
          },
          { name: 'atlassian_connection_id', type: 'uuid', isNullable: false },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'enabled', type: 'boolean', isNullable: false, default: true },
          { name: 'jira_board_id', type: 'int', isNullable: true },
          { name: 'jql', type: 'text', isNullable: true },
          { name: 'confluence_space_key', type: 'varchar', length: '64', isNullable: true },
          { name: 'confluence_root_page_id', type: 'varchar', length: '64', isNullable: true },
          { name: 'cql', type: 'text', isNullable: true },
          { name: 'agenstra_parent_ticket_id', type: 'uuid', isNullable: true },
          { name: 'agenstra_parent_folder_id', type: 'uuid', isNullable: true },
          { name: 'last_run_at', type: 'timestamptz', isNullable: true },
          { name: 'last_error', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'external_import_configs',
      new TableForeignKey({
        columnNames: ['atlassian_connection_id'],
        referencedTableName: 'atlassian_site_connections',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'external_import_configs',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'external_import_configs',
      new TableForeignKey({
        columnNames: ['agenstra_parent_ticket_id'],
        referencedTableName: 'tickets',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createForeignKey(
      'external_import_configs',
      new TableForeignKey({
        columnNames: ['agenstra_parent_folder_id'],
        referencedTableName: 'knowledge_nodes',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.query(`
      ALTER TABLE external_import_configs
      ADD CONSTRAINT chk_external_import_provider CHECK (provider = 'atlassian')
    `);
    await queryRunner.query(`
      ALTER TABLE external_import_configs
      ADD CONSTRAINT chk_external_import_kind CHECK (import_kind IN ('jira', 'confluence'))
    `);
    await queryRunner.query(`
      ALTER TABLE external_import_configs
      ADD CONSTRAINT chk_external_import_jira_parent CHECK (
        import_kind <> 'jira' OR agenstra_parent_folder_id IS NULL
      )
    `);
    await queryRunner.query(`
      ALTER TABLE external_import_configs
      ADD CONSTRAINT chk_external_import_conf_parent CHECK (
        import_kind <> 'confluence' OR agenstra_parent_ticket_id IS NULL
      )
    `);

    await queryRunner.createIndex(
      'external_import_configs',
      new TableIndex({
        name: 'IDX_external_import_configs_client_enabled',
        columnNames: ['client_id', 'enabled', 'provider'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'external_import_sync_markers',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'import_config_id', type: 'uuid', isNullable: false },
          { name: 'external_type', type: 'varchar', length: '32', isNullable: false },
          { name: 'external_id', type: 'varchar', length: '256', isNullable: false },
          { name: 'local_ticket_id', type: 'uuid', isNullable: true },
          { name: 'local_knowledge_node_id', type: 'uuid', isNullable: true },
          { name: 'content_hash', type: 'varchar', length: '64', isNullable: true },
          { name: 'last_imported_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamptz', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'external_import_sync_markers',
      new TableForeignKey({
        columnNames: ['import_config_id'],
        referencedTableName: 'external_import_configs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'external_import_sync_markers',
      new TableForeignKey({
        columnNames: ['local_ticket_id'],
        referencedTableName: 'tickets',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createForeignKey(
      'external_import_sync_markers',
      new TableForeignKey({
        columnNames: ['local_knowledge_node_id'],
        referencedTableName: 'knowledge_nodes',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'external_import_sync_markers',
      new TableUnique({
        name: 'UQ_external_import_marker_config_ext',
        columnNames: ['import_config_id', 'external_type', 'external_id'],
      }),
    );

    await queryRunner.createIndex(
      'external_import_sync_markers',
      new TableIndex({
        name: 'IDX_external_import_markers_local_ticket',
        columnNames: ['local_ticket_id'],
      }),
    );
    await queryRunner.createIndex(
      'external_import_sync_markers',
      new TableIndex({
        name: 'IDX_external_import_markers_local_knowledge',
        columnNames: ['local_knowledge_node_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('external_import_sync_markers');
    await queryRunner.dropTable('external_import_configs');
    await queryRunner.dropTable('atlassian_site_connections');
  }
}
