import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateOpenPositionsTable1767500000000 implements MigrationInterface {
  name = 'CreateOpenPositionsTable1767500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'billing_open_positions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'subscription_id', type: 'uuid' },
          { name: 'user_id', type: 'uuid' },
          { name: 'description', type: 'varchar', length: '500', isNullable: true },
          { name: 'bill_until', type: 'timestamp' },
          {
            name: 'skip_if_no_billable_amount',
            type: 'boolean',
            isNullable: false,
            default: true,
          },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'invoice_ref_id', type: 'uuid', isNullable: true },
        ],
        foreignKeys: [
          {
            columnNames: ['subscription_id'],
            referencedTableName: 'billing_subscriptions',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['invoice_ref_id'],
            referencedTableName: 'billing_invoice_refs',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('billing_open_positions');
  }
}
