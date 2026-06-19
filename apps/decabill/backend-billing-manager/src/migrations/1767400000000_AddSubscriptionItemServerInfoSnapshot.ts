import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSubscriptionItemServerInfoSnapshot1767400000000 implements MigrationInterface {
  name = 'AddSubscriptionItemServerInfoSnapshot1767400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_subscription_items',
      new TableColumn({
        name: 'server_info_snapshot',
        type: 'jsonb',
        isNullable: true,
        default: undefined,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_subscription_items', 'server_info_snapshot');
  }
}
