import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Migration to create statistics_chat_filter_flags table.
 * Records messages that were flagged/modified by filters but NOT dropped.
 */
export class CreateStatisticsFilterFlagsTable1766100000000 implements MigrationInterface {
  name = 'CreateStatisticsFilterFlagsTable1766100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "statistics_filter_flag_direction_enum" AS ENUM ('incoming', 'outgoing');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.createTable(
      new Table({
        name: 'statistics_chat_filter_flags',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'statistics_agent_id', type: 'uuid', isNullable: true },
          { name: 'statistics_client_id', type: 'uuid', isNullable: false },
          { name: 'statistics_user_id', type: 'uuid', isNullable: true },
          { name: 'filter_type', type: 'varchar', length: '100', isNullable: false },
          { name: 'filter_display_name', type: 'varchar', length: '255', isNullable: false },
          { name: 'filter_reason', type: 'text', isNullable: true },
          {
            name: 'direction',
            type: 'enum',
            enum: ['incoming', 'outgoing'],
            enumName: 'statistics_filter_flag_direction_enum',
            isNullable: false,
          },
          { name: 'word_count', type: 'int', isNullable: false, default: 0 },
          { name: 'char_count', type: 'int', isNullable: false, default: 0 },
          { name: 'occurred_at', type: 'timestamp', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'statistics_chat_filter_flags',
      new TableIndex({
        name: 'IDX_statistics_chat_filter_flags_statistics_agent_id_occurred_at',
        columnNames: ['statistics_agent_id', 'occurred_at'],
      }),
    );
    await queryRunner.createIndex(
      'statistics_chat_filter_flags',
      new TableIndex({
        name: 'IDX_statistics_chat_filter_flags_filter_type_occurred_at',
        columnNames: ['filter_type', 'occurred_at'],
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_chat_filter_flags',
      new TableForeignKey({
        columnNames: ['statistics_agent_id'],
        referencedTableName: 'statistics_agents',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_chat_filter_flags_statistics_agent_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_chat_filter_flags',
      new TableForeignKey({
        columnNames: ['statistics_client_id'],
        referencedTableName: 'statistics_clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_statistics_chat_filter_flags_statistics_client_id',
      }),
    );
    await queryRunner.createForeignKey(
      'statistics_chat_filter_flags',
      new TableForeignKey({
        columnNames: ['statistics_user_id'],
        referencedTableName: 'statistics_users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_statistics_chat_filter_flags_statistics_user_id',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('statistics_chat_filter_flags');

    if (table) {
      for (const fk of table.foreignKeys) {
        await queryRunner.dropForeignKey('statistics_chat_filter_flags', fk);
      }

      await queryRunner.dropIndex(
        'statistics_chat_filter_flags',
        'IDX_statistics_chat_filter_flags_filter_type_occurred_at',
      );
      await queryRunner.dropIndex(
        'statistics_chat_filter_flags',
        'IDX_statistics_chat_filter_flags_statistics_agent_id_occurred_at',
      );
      await queryRunner.dropTable('statistics_chat_filter_flags');
      await queryRunner.query('DROP TYPE IF EXISTS "statistics_filter_flag_direction_enum"');
    }
  }
}
