import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Migration to create regex_filter_rules for DB-backed chat filters.
 */
export class CreateRegexFilterRulesTable1770100000000 implements MigrationInterface {
  name = 'CreateRegexFilterRulesTable1770100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'regex_filter_rules',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'pattern',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'regex_flags',
            type: 'varchar',
            length: '16',
            isNullable: false,
            default: "'g'",
          },
          {
            name: 'direction',
            type: 'varchar',
            length: '32',
            isNullable: false,
          },
          {
            name: 'filter_type',
            type: 'varchar',
            length: '16',
            isNullable: false,
          },
          {
            name: 'replace_content',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'priority',
            type: 'int',
            isNullable: false,
            default: 0,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'regex_filter_rules',
      new TableIndex({
        name: 'IDX_regex_filter_rules_priority',
        columnNames: ['priority', 'created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('regex_filter_rules', 'IDX_regex_filter_rules_priority');
    await queryRunner.dropTable('regex_filter_rules');
  }
}
