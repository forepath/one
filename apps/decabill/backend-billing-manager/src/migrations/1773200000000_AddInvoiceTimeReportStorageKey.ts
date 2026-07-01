import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddInvoiceTimeReportStorageKey1773200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_invoices',
      new TableColumn({
        name: 'time_report_storage_key',
        type: 'varchar',
        length: '512',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_invoices', 'time_report_storage_key');
  }
}
