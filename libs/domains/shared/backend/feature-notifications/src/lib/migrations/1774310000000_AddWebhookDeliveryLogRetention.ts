import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddWebhookDeliveryLogRetention1774310000000 implements MigrationInterface {
  name = 'AddWebhookDeliveryLogRetention1774310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('webhook_endpoints', [
      new TableColumn({
        name: 'delivery_log_retention_days',
        type: 'int',
        isNullable: true,
      }),
      new TableColumn({
        name: 'delivery_log_max_entries',
        type: 'int',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('webhook_endpoints', 'delivery_log_max_entries');
    await queryRunner.dropColumn('webhook_endpoints', 'delivery_log_retention_days');
  }
}
