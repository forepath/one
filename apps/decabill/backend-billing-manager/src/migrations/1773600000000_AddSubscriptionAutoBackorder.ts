import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSubscriptionAutoBackorder1773600000000 implements MigrationInterface {
  name = 'AddSubscriptionAutoBackorder1773600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_subscriptions',
      new TableColumn({
        name: 'auto_backorder',
        type: 'boolean',
        isNullable: false,
        default: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_subscriptions', 'auto_backorder');
  }
}
