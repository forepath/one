import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Drops the statistics shadow of the removed agent container type.
 */
export class DropStatisticsAgentContainerType1793200000000 implements MigrationInterface {
  name = 'DropStatisticsAgentContainerType1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "statistics_agents" DROP COLUMN IF EXISTS "container_type"');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'statistics_agents',
      new TableColumn({
        name: 'container_type',
        type: 'varchar',
        length: '50',
        default: "'generic'",
        isNullable: false,
      }),
    );
  }
}
