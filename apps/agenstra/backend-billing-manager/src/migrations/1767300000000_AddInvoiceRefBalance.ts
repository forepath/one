import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddInvoiceRefBalance1767300000000 implements MigrationInterface {
  name = 'AddInvoiceRefBalance1767300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_invoice_refs',
      new TableColumn({
        name: 'balance',
        type: 'decimal',
        precision: 12,
        scale: 4,
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_invoice_refs', 'balance');
  }
}
