import { MigrationInterface, QueryRunner, TableForeignKey } from 'typeorm';

export class EnsureWebhookDeliveryEndpointCascade1774320000000 implements MigrationInterface {
  name = 'EnsureWebhookDeliveryEndpointCascade1774320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM webhook_deliveries delivery
      WHERE NOT EXISTS (
        SELECT 1 FROM webhook_endpoints endpoint WHERE endpoint.id = delivery.endpoint_id
      )
    `);

    const table = await queryRunner.getTable('webhook_deliveries');
    const existingForeignKey = table?.foreignKeys.find((foreignKey) => foreignKey.columnNames.includes('endpoint_id'));

    if (existingForeignKey) {
      await queryRunner.dropForeignKey('webhook_deliveries', existingForeignKey);
    }

    await queryRunner.createForeignKey(
      'webhook_deliveries',
      new TableForeignKey({
        name: 'fk_webhook_deliveries_endpoint_id',
        columnNames: ['endpoint_id'],
        referencedTableName: 'webhook_endpoints',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('webhook_deliveries', 'fk_webhook_deliveries_endpoint_id');

    await queryRunner.createForeignKey(
      'webhook_deliveries',
      new TableForeignKey({
        name: 'fk_webhook_deliveries_endpoint_id',
        columnNames: ['endpoint_id'],
        referencedTableName: 'webhook_endpoints',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }
}
