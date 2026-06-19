import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CustomBillingTables1770300000000 implements MigrationInterface {
  name = 'CustomBillingTables1770300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.renameTable('billing_invoice_refs', 'billing_invoice_refs_legacy');

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "invoice_status_enum" AS ENUM (
          'draft', 'issued', 'paid', 'partially_paid', 'overdue', 'void'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "tax_category_enum" AS ENUM ('standard', 'reduced');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "payment_attempt_status_enum" AS ENUM (
          'pending', 'succeeded', 'failed', 'canceled'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'billing_invoices',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'subscription_id', type: 'uuid' },
          { name: 'user_id', type: 'uuid' },
          { name: 'invoice_number', type: 'varchar', length: '64', isNullable: true },
          {
            name: 'status',
            type: 'enum',
            enumName: 'invoice_status_enum',
            default: "'draft'",
          },
          { name: 'currency', type: 'varchar', length: '10', default: "'EUR'" },
          { name: 'subtotal_net', type: 'numeric', precision: 12, scale: 4, default: 0 },
          { name: 'tax_total', type: 'numeric', precision: 12, scale: 4, default: 0 },
          { name: 'total_gross', type: 'numeric', precision: 12, scale: 4, default: 0 },
          { name: 'balance_due', type: 'numeric', precision: 12, scale: 4, default: 0 },
          { name: 'issued_at', type: 'timestamp', isNullable: true },
          { name: 'due_date', type: 'date', isNullable: true },
          { name: 'voided_at', type: 'timestamp', isNullable: true },
          { name: 'pdf_storage_key', type: 'varchar', length: '512', isNullable: true },
          { name: 'payment_processor', type: 'varchar', length: '50', isNullable: true },
          { name: 'external_payment_id', type: 'varchar', length: '255', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['subscription_id'],
            referencedTableName: 'billing_subscriptions',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_invoice_line_items',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'invoice_id', type: 'uuid' },
          { name: 'position', type: 'int', default: 0 },
          { name: 'description', type: 'varchar', length: '500' },
          { name: 'quantity', type: 'numeric', precision: 12, scale: 4, default: 1 },
          { name: 'unit_price_net', type: 'numeric', precision: 12, scale: 4 },
          { name: 'tax_category', type: 'enum', enumName: 'tax_category_enum', default: "'standard'" },
          { name: 'tax_rate', type: 'numeric', precision: 8, scale: 4 },
          { name: 'line_net', type: 'numeric', precision: 12, scale: 4 },
          { name: 'line_tax', type: 'numeric', precision: 12, scale: 4 },
          { name: 'line_gross', type: 'numeric', precision: 12, scale: 4 },
        ],
        foreignKeys: [
          {
            columnNames: ['invoice_id'],
            referencedTableName: 'billing_invoices',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_invoice_number_sequences',
        columns: [
          { name: 'year', type: 'int', isPrimary: true },
          { name: 'last_value', type: 'int', default: 0 },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_payment_attempts',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'invoice_id', type: 'uuid' },
          { name: 'processor', type: 'varchar', length: '50' },
          { name: 'external_id', type: 'varchar', length: '255', isNullable: true },
          {
            name: 'status',
            type: 'enum',
            enumName: 'payment_attempt_status_enum',
            default: "'pending'",
          },
          { name: 'amount', type: 'numeric', precision: 12, scale: 4 },
          { name: 'currency', type: 'varchar', length: '10', default: "'EUR'" },
          { name: 'idempotency_key', type: 'varchar', length: '255', isUnique: true },
          { name: 'metadata', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['invoice_id'],
            referencedTableName: 'billing_invoices',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_payment_webhook_events',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'processor', type: 'varchar', length: '50' },
          { name: 'event_id', type: 'varchar', length: '255', isUnique: true },
          { name: 'payload_hash', type: 'varchar', length: '64', isNullable: true },
          { name: 'processed_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'result', type: 'varchar', length: '50' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_audit_logs',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'correlation_id', type: 'varchar', length: '64', isNullable: true },
          { name: 'process', type: 'varchar', length: '100' },
          { name: 'invoice_id', type: 'uuid', isNullable: true },
          { name: 'user_id', type: 'uuid', isNullable: true },
          { name: 'level', type: 'varchar', length: '20' },
          { name: 'message', type: 'text' },
          { name: 'context', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    const openPositionsTable = await queryRunner.getTable('billing_open_positions');
    const invoiceRefFk = openPositionsTable?.foreignKeys.find((fk) => fk.columnNames.includes('invoice_ref_id'));

    if (invoiceRefFk) {
      await queryRunner.dropForeignKey('billing_open_positions', invoiceRefFk);
    }

    await queryRunner.createForeignKey(
      'billing_open_positions',
      new TableForeignKey({
        columnNames: ['invoice_ref_id'],
        referencedTableName: 'billing_invoices',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.query(`ALTER TABLE billing_customer_profiles DROP COLUMN IF EXISTS invoice_ninja_client_id`);
    await queryRunner.query(
      `ALTER TABLE billing_customer_profiles ADD COLUMN IF NOT EXISTS stripe_customer_id varchar(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE billing_customer_profiles DROP COLUMN IF EXISTS stripe_customer_id`);
    await queryRunner.query(
      `ALTER TABLE billing_customer_profiles ADD COLUMN IF NOT EXISTS invoice_ninja_client_id varchar(255)`,
    );

    const openPositionsTableDown = await queryRunner.getTable('billing_open_positions');
    const openPosFk = openPositionsTableDown?.foreignKeys.find((fk) => fk.columnNames.includes('invoice_ref_id'));

    if (openPosFk) {
      await queryRunner.dropForeignKey('billing_open_positions', openPosFk);
    }

    await queryRunner.createForeignKey(
      'billing_open_positions',
      new TableForeignKey({
        columnNames: ['invoice_ref_id'],
        referencedTableName: 'billing_invoice_refs_legacy',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.dropTable('billing_audit_logs');
    await queryRunner.dropTable('billing_payment_webhook_events');
    await queryRunner.dropTable('billing_payment_attempts');
    await queryRunner.dropTable('billing_invoice_number_sequences');
    await queryRunner.dropTable('billing_invoice_line_items');
    await queryRunner.dropTable('billing_invoices');
    await queryRunner.renameTable('billing_invoice_refs_legacy', 'billing_invoice_refs');

    await queryRunner.query(`DROP TYPE IF EXISTS "payment_attempt_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tax_category_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "invoice_status_enum"`);
  }
}
