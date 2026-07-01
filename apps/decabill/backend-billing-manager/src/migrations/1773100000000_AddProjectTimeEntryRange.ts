import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddProjectTimeEntryRange1773100000000 implements MigrationInterface {
  name = 'AddProjectTimeEntryRange1773100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_project_time_entries',
      new TableColumn({ name: 'started_at', type: 'timestamp', isNullable: true }),
    );
    await queryRunner.addColumn(
      'billing_project_time_entries',
      new TableColumn({ name: 'ended_at', type: 'timestamp', isNullable: true }),
    );

    await queryRunner.query(`
      UPDATE billing_project_time_entries
      SET
        started_at = recorded_at,
        ended_at = recorded_at + (duration_minutes * INTERVAL '1 minute')
      WHERE started_at IS NULL OR ended_at IS NULL
    `);

    await queryRunner.changeColumn(
      'billing_project_time_entries',
      'started_at',
      new TableColumn({ name: 'started_at', type: 'timestamp', isNullable: false }),
    );
    await queryRunner.changeColumn(
      'billing_project_time_entries',
      'ended_at',
      new TableColumn({ name: 'ended_at', type: 'timestamp', isNullable: false }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_project_time_entries', 'ended_at');
    await queryRunner.dropColumn('billing_project_time_entries', 'started_at');
  }
}
