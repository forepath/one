import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddInvoiceRefDueDate1767700000000 implements MigrationInterface {
  name = 'AddInvoiceRefDueDate1767700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_invoice_refs',
      new TableColumn({
        name: 'due_date',
        type: 'date',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_invoice_refs', 'due_date');
  }
}
