import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSubscriptionAndInvoiceNumbers1767200000000 implements MigrationInterface {
  name = 'AddSubscriptionAndInvoiceNumbers1767200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS billing_subscription_number_seq`);

    await queryRunner.addColumn(
      'billing_subscriptions',
      new TableColumn({
        name: 'number',
        type: 'varchar',
        length: '50',
        isNullable: false,
        isUnique: true,
        default: "concat('SUB-', lpad(nextval('billing_subscription_number_seq')::text, 6, '0'))",
      }),
    );

    await queryRunner.query(`
      UPDATE billing_subscriptions
      SET number = concat('SUB-', lpad(nextval('billing_subscription_number_seq')::text, 6, '0'))
      WHERE number IS NULL
    `);

    await queryRunner.addColumn(
      'billing_invoice_refs',
      new TableColumn({
        name: 'invoice_number',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_invoice_refs', 'invoice_number');
    await queryRunner.dropColumn('billing_subscriptions', 'number');
    await queryRunner.query(`DROP SEQUENCE IF EXISTS billing_subscription_number_seq`);
  }
}
