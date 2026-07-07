import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddProjectTargetHours1773400000000 implements MigrationInterface {
  name = 'AddProjectTargetHours1773400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_projects',
      new TableColumn({
        name: 'target_hours',
        type: 'decimal',
        precision: 8,
        scale: 2,
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_projects', 'target_hours');
  }
}
