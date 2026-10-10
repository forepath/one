import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Store the GCM-encrypted values replaced by agent-level environment variables, so removing a variable
 * restores the previous value instead of leaving the stale one in the container.
 */
export class AddEnvironmentVariableBaselineToAgentsTable1791700000000 implements MigrationInterface {
  name = 'AddEnvironmentVariableBaselineToAgentsTable1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'environment_variable_baseline',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('agents', 'environment_variable_baseline');
  }
}
