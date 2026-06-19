import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateBillingTables1767100000000 implements MigrationInterface {
  name = 'CreateBillingTables1767100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "billing_interval_type_enum" AS ENUM ('hour', 'day', 'month');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "subscription_status_enum" AS ENUM ('active', 'pending_backorder', 'pending_cancel', 'canceled');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "provisioning_status_enum" AS ENUM ('pending', 'active', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "backorder_status_enum" AS ENUM ('pending', 'retrying', 'fulfilled', 'cancelled', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'billing_service_types',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'key', type: 'varchar', length: '100', isUnique: true },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'provider', type: 'varchar', length: '100' },
          { name: 'config_schema', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_service_plans',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'service_type_id', type: 'uuid' },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'billing_interval_type', type: 'enum', enumName: 'billing_interval_type_enum' },
          { name: 'billing_interval_value', type: 'int' },
          { name: 'billing_day_of_month', type: 'int', isNullable: true },
          { name: 'cancel_at_period_end', type: 'boolean', default: true },
          { name: 'min_commitment_days', type: 'int', default: 0 },
          { name: 'notice_days', type: 'int', default: 0 },
          { name: 'base_price', type: 'numeric', precision: 12, scale: 4, isNullable: true },
          { name: 'margin_percent', type: 'numeric', precision: 8, scale: 4, isNullable: true },
          { name: 'margin_fixed', type: 'numeric', precision: 12, scale: 4, isNullable: true },
          { name: 'provider_config_defaults', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['service_type_id'],
            referencedTableName: 'billing_service_types',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_subscriptions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'plan_id', type: 'uuid' },
          { name: 'user_id', type: 'uuid' },
          { name: 'status', type: 'enum', enumName: 'subscription_status_enum', default: "'active'" },
          { name: 'current_period_start', type: 'timestamp', isNullable: true },
          { name: 'current_period_end', type: 'timestamp', isNullable: true },
          { name: 'next_billing_at', type: 'timestamp', isNullable: true },
          { name: 'cancel_requested_at', type: 'timestamp', isNullable: true },
          { name: 'cancel_effective_at', type: 'timestamp', isNullable: true },
          { name: 'resumed_at', type: 'timestamp', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          { columnNames: ['plan_id'], referencedTableName: 'billing_service_plans', referencedColumnNames: ['id'] },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_subscription_items',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'subscription_id', type: 'uuid' },
          { name: 'service_type_id', type: 'uuid' },
          { name: 'config_snapshot', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'provisioning_status', type: 'enum', enumName: 'provisioning_status_enum', default: "'pending'" },
          { name: 'provider_reference', type: 'varchar', length: '255', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['subscription_id'],
            referencedTableName: 'billing_subscriptions',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['service_type_id'],
            referencedTableName: 'billing_service_types',
            referencedColumnNames: ['id'],
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_usage_records',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'subscription_id', type: 'uuid' },
          { name: 'period_start', type: 'timestamp' },
          { name: 'period_end', type: 'timestamp' },
          { name: 'usage_source', type: 'varchar', length: '255' },
          { name: 'usage_payload', type: 'jsonb', default: "'{}'::jsonb" },
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
        name: 'billing_invoice_refs',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'subscription_id', type: 'uuid' },
          { name: 'invoice_ninja_id', type: 'varchar', length: '255' },
          { name: 'pre_auth_url', type: 'text' },
          { name: 'status', type: 'varchar', length: '50', isNullable: true },
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
        name: 'billing_provider_price_snapshots',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'provider', type: 'varchar', length: '100' },
          { name: 'provider_product_id', type: 'varchar', length: '255' },
          { name: 'raw_price_payload', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'resolved_base_price', type: 'numeric', precision: 12, scale: 4 },
          { name: 'currency', type: 'varchar', length: '10', default: "'EUR'" },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_backorders',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'user_id', type: 'uuid' },
          { name: 'service_type_id', type: 'uuid' },
          { name: 'plan_id', type: 'uuid' },
          { name: 'requested_config_snapshot', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'status', type: 'enum', enumName: 'backorder_status_enum', default: "'pending'" },
          { name: 'failure_reason', type: 'varchar', length: '255', isNullable: true },
          { name: 'provider_errors', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'preferred_alternatives', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'retry_after', type: 'timestamp', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_availability_snapshots',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'provider', type: 'varchar', length: '100' },
          { name: 'region', type: 'varchar', length: '100' },
          { name: 'server_type', type: 'varchar', length: '100' },
          { name: 'is_available', type: 'boolean' },
          { name: 'raw_response', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'captured_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_customer_profiles',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'user_id', type: 'uuid', isUnique: true },
          { name: 'first_name', type: 'varchar', length: '255', isNullable: true },
          { name: 'last_name', type: 'varchar', length: '255', isNullable: true },
          { name: 'company', type: 'varchar', length: '255', isNullable: true },
          { name: 'address_line_1', type: 'varchar', length: '255', isNullable: true },
          { name: 'address_line_2', type: 'varchar', length: '255', isNullable: true },
          { name: 'postal_code', type: 'varchar', length: '30', isNullable: true },
          { name: 'city', type: 'varchar', length: '255', isNullable: true },
          { name: 'state', type: 'varchar', length: '255', isNullable: true },
          { name: 'country', type: 'varchar', length: '2', isNullable: true },
          { name: 'email', type: 'varchar', length: '255', isNullable: true },
          { name: 'phone', type: 'varchar', length: '50', isNullable: true },
          { name: 'invoice_ninja_client_id', type: 'varchar', length: '255', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('billing_customer_profiles');
    await queryRunner.dropTable('billing_availability_snapshots');
    await queryRunner.dropTable('billing_backorders');
    await queryRunner.dropTable('billing_provider_price_snapshots');
    await queryRunner.dropTable('billing_invoice_refs');
    await queryRunner.dropTable('billing_usage_records');
    await queryRunner.dropTable('billing_subscription_items');
    await queryRunner.dropTable('billing_subscriptions');
    await queryRunner.dropTable('billing_service_plans');
    await queryRunner.dropTable('billing_service_types');

    await queryRunner.query(`DROP TYPE IF EXISTS "backorder_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "provisioning_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscription_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "billing_interval_type_enum"`);
  }
}
