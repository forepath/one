import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateOfferTables1777400000000 implements MigrationInterface {
  name = 'CreateOfferTables1777400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "offer_status_enum" AS ENUM ('draft', 'archived', 'accepted', 'declined', 'expired', 'revoked');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "offer_line_type_enum" AS ENUM ('standard', 'project_template', 'plan_template');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "offer_fulfillment_status_enum" AS ENUM ('pending', 'scheduled', 'completed', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'billing_offers',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'user_id', type: 'uuid' },
          { name: 'offer_number', type: 'varchar', length: '64', isNullable: true },
          { name: 'number_scope', type: 'varchar', length: '64', isNullable: true },
          {
            name: 'status',
            type: 'enum',
            enumName: 'offer_status_enum',
            default: "'draft'",
          },
          { name: 'currency', type: 'varchar', length: '10', default: "'EUR'" },
          { name: 'subtotal_net', type: 'numeric', precision: 12, scale: 4, default: 0 },
          { name: 'tax_total', type: 'numeric', precision: 12, scale: 4, default: 0 },
          { name: 'total_gross', type: 'numeric', precision: 12, scale: 4, default: 0 },
          { name: 'tax_mode', type: 'varchar', length: '64', isNullable: true },
          { name: 'tax_country_code', type: 'varchar', length: '2', isNullable: true },
          { name: 'tax_note', type: 'text', isNullable: true },
          { name: 'einvoice_tax_category_code', type: 'varchar', length: '8', isNullable: true },
          { name: 'resolved_tax_rate', type: 'numeric', precision: 8, scale: 4, isNullable: true },
          { name: 'buyer_vat_id', type: 'varchar', length: '32', isNullable: true },
          { name: 'buyer_country', type: 'varchar', length: '2', isNullable: true },
          { name: 'buyer_customer_type', type: 'varchar', length: '16', isNullable: true },
          { name: 'issuer_country', type: 'varchar', length: '2', isNullable: true },
          { name: 'issuer_is_in_eu', type: 'boolean', isNullable: true },
          { name: 'expires_at', type: 'timestamp', isNullable: true },
          { name: 'archived_at', type: 'timestamp', isNullable: true },
          { name: 'accepted_at', type: 'timestamp', isNullable: true },
          { name: 'declined_at', type: 'timestamp', isNullable: true },
          { name: 'expired_at', type: 'timestamp', isNullable: true },
          { name: 'revoked_at', type: 'timestamp', isNullable: true },
          { name: 'bill_to_open_positions', type: 'boolean', default: false },
          { name: 'pdf_storage_key', type: 'varchar', length: '512', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
        ],
        indices: [
          new TableIndex({ name: 'IDX_billing_offers_user_status', columnNames: ['user_id', 'status'] }),
          new TableIndex({ name: 'IDX_billing_offers_status_expires', columnNames: ['status', 'expires_at'] }),
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_offer_line_items',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'offer_id', type: 'uuid' },
          { name: 'position', type: 'int', default: 0 },
          {
            name: 'line_type',
            type: 'enum',
            enumName: 'offer_line_type_enum',
          },
          { name: 'description', type: 'varchar', length: '500' },
          { name: 'quantity', type: 'numeric', precision: 12, scale: 4, default: 1 },
          { name: 'unit_label', type: 'varchar', length: '64', isNullable: true },
          { name: 'unit_price_net', type: 'numeric', precision: 12, scale: 4 },
          {
            name: 'tax_category',
            type: 'enum',
            enumName: 'tax_category_enum',
            default: "'standard'",
          },
          { name: 'tax_rate', type: 'numeric', precision: 8, scale: 4 },
          { name: 'line_net', type: 'numeric', precision: 12, scale: 4 },
          { name: 'line_tax', type: 'numeric', precision: 12, scale: 4 },
          { name: 'line_gross', type: 'numeric', precision: 12, scale: 4 },
          { name: 'scheduled_at', type: 'timestamp', isNullable: true },
          { name: 'fulfilled_at', type: 'timestamp', isNullable: true },
          { name: 'result_subscription_id', type: 'uuid', isNullable: true },
          { name: 'result_project_id', type: 'uuid', isNullable: true },
          { name: 'result_invoice_id', type: 'uuid', isNullable: true },
          {
            name: 'fulfillment_status',
            type: 'enum',
            enumName: 'offer_fulfillment_status_enum',
            default: "'pending'",
          },
          { name: 'fulfillment_error', type: 'text', isNullable: true },
          { name: 'project_template_payload', type: 'jsonb', isNullable: true },
          { name: 'plan_id', type: 'uuid', isNullable: true },
          { name: 'effective_config_snapshot', type: 'text', isNullable: true },
          { name: 'addon_configs_snapshot', type: 'text', isNullable: true },
          { name: 'addon_ids', type: 'jsonb', isNullable: true },
          { name: 'preferred_alternatives', type: 'jsonb', isNullable: true },
          { name: 'auto_backorder', type: 'boolean', default: false },
          { name: 'promotion_code', type: 'varchar', length: '64', isNullable: true },
          { name: 'pricing_snapshot', type: 'jsonb', isNullable: true },
          { name: 'plan_name_snapshot', type: 'varchar', length: '255', isNullable: true },
          { name: 'availability_checked_at', type: 'timestamp', isNullable: true },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['offer_id'],
            referencedTableName: 'billing_offers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_offer_number_sequences',
        columns: [
          { name: 'tenant_id', type: 'varchar', length: '64', default: "'default'", isPrimary: true },
          { name: 'year', type: 'int', isPrimary: true },
          { name: 'last_value', type: 'int', default: 0 },
        ],
      }),
      true,
    );

    const hasOfferId = await queryRunner.hasColumn('billing_audit_logs', 'offer_id');

    if (!hasOfferId) {
      await queryRunner.query(`ALTER TABLE "billing_audit_logs" ADD "offer_id" uuid`);
      await queryRunner.query(`CREATE INDEX "IDX_billing_audit_logs_offer_id" ON "billing_audit_logs" ("offer_id")`);
    }

    const hasInvoiceOfferId = await queryRunner.hasColumn('billing_invoices', 'offer_id');

    if (!hasInvoiceOfferId) {
      await queryRunner.query(`ALTER TABLE "billing_invoices" ADD "offer_id" uuid`);
      await queryRunner.query(`CREATE INDEX "IDX_billing_invoices_offer_id" ON "billing_invoices" ("offer_id")`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('billing_invoices', 'offer_id')) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_invoices_offer_id"`);
      await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN "offer_id"`);
    }

    if (await queryRunner.hasColumn('billing_audit_logs', 'offer_id')) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_audit_logs_offer_id"`);
      await queryRunner.query(`ALTER TABLE "billing_audit_logs" DROP COLUMN "offer_id"`);
    }

    await queryRunner.dropTable('billing_offer_line_items', true);
    await queryRunner.dropTable('billing_offers', true);
    await queryRunner.dropTable('billing_offer_number_sequences', true);
    await queryRunner.query(`DROP TYPE IF EXISTS "offer_fulfillment_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "offer_line_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "offer_status_enum"`);
  }
}
