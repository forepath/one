import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Add nullable token / cost columns to statistics_chat_io for OpenCode usage accounting.
 */
export class AddTokenUsageToStatisticsChatIo1774300000000 implements MigrationInterface {
  name = 'AddTokenUsageToStatisticsChatIo1774300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('statistics_chat_io', [
      new TableColumn({
        name: 'input_tokens',
        type: 'int',
        isNullable: true,
      }),
      new TableColumn({
        name: 'output_tokens',
        type: 'int',
        isNullable: true,
      }),
      new TableColumn({
        name: 'reasoning_tokens',
        type: 'int',
        isNullable: true,
      }),
      new TableColumn({
        name: 'cache_read_tokens',
        type: 'int',
        isNullable: true,
      }),
      new TableColumn({
        name: 'cache_write_tokens',
        type: 'int',
        isNullable: true,
      }),
      new TableColumn({
        name: 'cost_usd',
        type: 'decimal',
        precision: 16,
        scale: 8,
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('statistics_chat_io', 'cost_usd');
    await queryRunner.dropColumn('statistics_chat_io', 'cache_write_tokens');
    await queryRunner.dropColumn('statistics_chat_io', 'cache_read_tokens');
    await queryRunner.dropColumn('statistics_chat_io', 'reasoning_tokens');
    await queryRunner.dropColumn('statistics_chat_io', 'output_tokens');
    await queryRunner.dropColumn('statistics_chat_io', 'input_tokens');
  }
}
