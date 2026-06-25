import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateDatevExports1771200000000 implements MigrationInterface {
  name = 'CreateDatevExports1771200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE datev_export_scope_enum AS ENUM ('tenant', 'unified');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE datev_export_status_enum AS ENUM ('pending', 'running', 'completed', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'billing_datev_exports',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'scope',
            type: 'datev_export_scope_enum',
            default: `'tenant'`,
          },
          { name: 'tenant_id', type: 'varchar', length: '64' },
          { name: 'period_year', type: 'int' },
          { name: 'period_month', type: 'int' },
          {
            name: 'status',
            type: 'datev_export_status_enum',
            default: `'pending'`,
          },
          { name: 'storage_key', type: 'varchar', length: '512', isNullable: true },
          { name: 'file_name', type: 'varchar', length: '255', isNullable: true },
          { name: 'booking_count', type: 'int', default: 0 },
          { name: 'invoice_count', type: 'int', default: 0 },
          { name: 'debtor_count', type: 'int', default: 0 },
          { name: 'included_tenant_ids', type: 'jsonb', isNullable: true },
          { name: 'error_message', type: 'text', isNullable: true },
          { name: 'triggered_by', type: 'varchar', length: '64', isNullable: true },
          { name: 'started_at', type: 'timestamp', isNullable: true },
          { name: 'completed_at', type: 'timestamp', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
          { name: 'updated_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'billing_datev_exports',
      new TableIndex({
        name: 'uq_billing_datev_exports_tenant_period',
        columnNames: ['tenant_id', 'period_year', 'period_month'],
        isUnique: true,
        where: `"scope" = 'tenant'`,
      }),
    );

    await queryRunner.createIndex(
      'billing_datev_exports',
      new TableIndex({
        name: 'uq_billing_datev_exports_unified_period',
        columnNames: ['period_year', 'period_month'],
        isUnique: true,
        where: `"scope" = 'unified'`,
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_datev_debtor_accounts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'tenant_id', type: 'varchar', length: '64' },
          { name: 'user_id', type: 'uuid' },
          { name: 'debtor_number', type: 'int' },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'billing_datev_debtor_accounts',
      new TableIndex({
        name: 'uq_billing_datev_debtor_accounts_tenant_user',
        columnNames: ['tenant_id', 'user_id'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'billing_datev_debtor_accounts',
      new TableIndex({
        name: 'uq_billing_datev_debtor_accounts_tenant_debtor',
        columnNames: ['tenant_id', 'debtor_number'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('billing_datev_debtor_accounts');
    await queryRunner.dropTable('billing_datev_exports');
    await queryRunner.query('DROP TYPE IF EXISTS datev_export_status_enum');
    await queryRunner.query('DROP TYPE IF EXISTS datev_export_scope_enum');
  }
}
