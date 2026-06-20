import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddTenantIdToBillingTables1770600000000 implements MigrationInterface {
  name = 'AddTenantIdToBillingTables1770600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('billing_service_types', 'tenant_id'))) {
      await queryRunner.addColumn(
        'billing_service_types',
        new TableColumn({
          name: 'tenant_id',
          type: 'varchar',
          length: '64',
          isNullable: false,
          default: "'default'",
        }),
      );
    }

    await queryRunner.query(`
      DO $$ DECLARE constraint_name text;
      BEGIN
        FOR constraint_name IN
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'billing_service_types'
            AND c.contype = 'u'
            AND array_length(c.conkey, 1) = 1
            AND EXISTS (
              SELECT 1
              FROM pg_attribute a
              WHERE a.attrelid = t.oid
                AND a.attnum = c.conkey[1]
                AND a.attname = 'key'
            )
        LOOP
          EXECUTE format('ALTER TABLE billing_service_types DROP CONSTRAINT %I', constraint_name);
        END LOOP;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_billing_service_types_tenant_key'
        ) THEN
          ALTER TABLE billing_service_types
            ADD CONSTRAINT uq_billing_service_types_tenant_key UNIQUE (tenant_id, key);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_service_types_tenant_id"
      ON billing_service_types (tenant_id)
    `);

    if (!(await queryRunner.hasColumn('billing_invoice_number_sequences', 'tenant_id'))) {
      await queryRunner.addColumn(
        'billing_invoice_number_sequences',
        new TableColumn({
          name: 'tenant_id',
          type: 'varchar',
          length: '64',
          isNullable: false,
          default: "'default'",
        }),
      );
    }

    await queryRunner.query(`
      DO $$ DECLARE pk_name text;
      BEGIN
        SELECT c.conname INTO pk_name
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_index i ON i.indexrelid = c.conindid
        WHERE t.relname = 'billing_invoice_number_sequences'
          AND c.contype = 'p'
          AND array_length(i.indkey, 1) = 1;
        IF pk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE billing_invoice_number_sequences DROP CONSTRAINT %I', pk_name);
          ALTER TABLE billing_invoice_number_sequences ADD PRIMARY KEY (tenant_id, year);
        END IF;
      END $$;
    `);

    if (!(await queryRunner.hasColumn('billing_audit_logs', 'tenant_id'))) {
      await queryRunner.addColumn(
        'billing_audit_logs',
        new TableColumn({
          name: 'tenant_id',
          type: 'varchar',
          length: '64',
          isNullable: true,
        }),
      );
    }

    await queryRunner.query(`UPDATE billing_audit_logs SET tenant_id = 'default' WHERE tenant_id IS NULL`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_audit_logs_tenant_id"
      ON billing_audit_logs (tenant_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_audit_logs_tenant_id"`);

    if (await queryRunner.hasColumn('billing_audit_logs', 'tenant_id')) {
      await queryRunner.dropColumn('billing_audit_logs', 'tenant_id');
    }

    await queryRunner.query(`
      DO $$ DECLARE pk_name text;
      BEGIN
        SELECT c.conname INTO pk_name
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_index i ON i.indexrelid = c.conindid
        WHERE t.relname = 'billing_invoice_number_sequences'
          AND c.contype = 'p'
          AND array_length(i.indkey, 1) = 2;
        IF pk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE billing_invoice_number_sequences DROP CONSTRAINT %I', pk_name);
          ALTER TABLE billing_invoice_number_sequences ADD PRIMARY KEY (year);
        END IF;
      END $$;
    `);

    if (await queryRunner.hasColumn('billing_invoice_number_sequences', 'tenant_id')) {
      await queryRunner.dropColumn('billing_invoice_number_sequences', 'tenant_id');
    }

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_service_types_tenant_id"`);
    await queryRunner.query(
      `ALTER TABLE billing_service_types DROP CONSTRAINT IF EXISTS uq_billing_service_types_tenant_key`,
    );

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'billing_service_types'
            AND c.contype = 'u'
            AND c.conname = 'UQ_billing_service_types_key'
        ) THEN
          ALTER TABLE billing_service_types ADD CONSTRAINT "UQ_billing_service_types_key" UNIQUE ("key");
        END IF;
      END $$;
    `);

    if (await queryRunner.hasColumn('billing_service_types', 'tenant_id')) {
      await queryRunner.dropColumn('billing_service_types', 'tenant_id');
    }
  }
}
