import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

export class CreateAgentConsoleRegexFilterRulesTables1770200000000 implements MigrationInterface {
  name = 'CreateAgentConsoleRegexFilterRulesTables1770200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'agent_console_regex_filter_rules',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'pattern', type: 'text', isNullable: false },
          { name: 'regex_flags', type: 'varchar', length: '16', isNullable: false, default: "'g'" },
          { name: 'direction', type: 'varchar', length: '32', isNullable: false },
          { name: 'filter_type', type: 'varchar', length: '16', isNullable: false },
          { name: 'replace_content', type: 'text', isNullable: true },
          { name: 'priority', type: 'int', isNullable: false, default: 0 },
          { name: 'enabled', type: 'boolean', isNullable: false, default: true },
          { name: 'is_global', type: 'boolean', isNullable: false, default: false },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'agent_console_regex_filter_rule_clients',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'rule_id', type: 'uuid', isNullable: false },
          { name: 'client_id', type: 'uuid', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'agent_console_regex_filter_rule_clients',
      new TableForeignKey({
        columnNames: ['rule_id'],
        referencedTableName: 'agent_console_regex_filter_rules',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'agent_console_regex_filter_rule_clients',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createUniqueConstraint(
      'agent_console_regex_filter_rule_clients',
      new TableUnique({
        name: 'UQ_console_regex_rule_client',
        columnNames: ['rule_id', 'client_id'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'agent_console_regex_filter_rule_sync_targets',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'rule_id', type: 'uuid', isNullable: false },
          { name: 'client_id', type: 'uuid', isNullable: false },
          { name: 'manager_rule_id', type: 'uuid', isNullable: true },
          { name: 'desired_on_manager', type: 'boolean', isNullable: false, default: true },
          { name: 'sync_status', type: 'varchar', length: '16', isNullable: false, default: "'pending'" },
          { name: 'last_error', type: 'text', isNullable: true },
          { name: 'last_synced_at', type: 'timestamp', isNullable: true },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'agent_console_regex_filter_rule_sync_targets',
      new TableForeignKey({
        columnNames: ['rule_id'],
        referencedTableName: 'agent_console_regex_filter_rules',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'agent_console_regex_filter_rule_sync_targets',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createUniqueConstraint(
      'agent_console_regex_filter_rule_sync_targets',
      new TableUnique({
        name: 'UQ_console_regex_sync_rule_client',
        columnNames: ['rule_id', 'client_id'],
      }),
    );
    await queryRunner.createIndex(
      'agent_console_regex_filter_rule_sync_targets',
      new TableIndex({
        name: 'IDX_console_regex_sync_status',
        columnNames: ['sync_status', 'desired_on_manager'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('agent_console_regex_filter_rule_sync_targets');
    await queryRunner.dropTable('agent_console_regex_filter_rule_clients');
    await queryRunner.dropTable('agent_console_regex_filter_rules');
  }
}
