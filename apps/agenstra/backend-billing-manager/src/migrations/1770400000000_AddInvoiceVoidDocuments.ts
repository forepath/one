import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class AddInvoiceVoidDocuments1770400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'billing_invoice_void_documents',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'invoice_id', type: 'uuid', isUnique: true },
          { name: 'document_number', type: 'varchar', length: '64' },
          { name: 'pdf_storage_key', type: 'varchar', length: '512' },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'billing_invoice_void_documents',
      new TableForeignKey({
        columnNames: ['invoice_id'],
        referencedTableName: 'billing_invoices',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('billing_invoice_void_documents');
    const foreignKey = table?.foreignKeys.find((fk) => fk.columnNames.includes('invoice_id'));

    if (foreignKey) {
      await queryRunner.dropForeignKey('billing_invoice_void_documents', foreignKey);
    }

    await queryRunner.dropTable('billing_invoice_void_documents');
  }
}
