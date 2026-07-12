import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

export class CreatePromotionTables1774100000000 implements MigrationInterface {
  name = 'CreatePromotionTables1774100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "promotion_advantage_type_enum" AS ENUM ('fixed_amount_net', 'free_days', 'free_billing_periods');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "promotion_subscription_eligibility_enum" AS ENUM ('new', 'existing', 'both');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "promotion_redemption_context_enum" AS ENUM ('new', 'existing');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "promotion_redemption_status_enum" AS ENUM ('active', 'exhausted', 'expired', 'cancelled');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'billing_promotions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'tenant_id', type: 'varchar', length: '64', default: "'default'" },
          { name: 'code', type: 'varchar', length: '64' },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'redeemable_from', type: 'timestamp' },
          { name: 'redeemable_to', type: 'timestamp' },
          { name: 'max_total_redemptions', type: 'int', isNullable: true },
          { name: 'max_per_user_redemptions', type: 'int', default: 1 },
          { name: 'is_active', type: 'boolean', default: true },
          {
            name: 'advantage_type',
            type: 'enum',
            enumName: 'promotion_advantage_type_enum',
          },
          { name: 'advantage_config', type: 'jsonb', default: "'{}'::jsonb" },
          { name: 'applicable_plan_ids', type: 'jsonb', isNullable: true },
          {
            name: 'subscription_eligibility',
            type: 'enum',
            enumName: 'promotion_subscription_eligibility_enum',
            default: "'both'",
          },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        uniques: [new TableUnique({ name: 'uq_billing_promotions_tenant_code', columnNames: ['tenant_id', 'code'] })],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_promotion_redemptions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'promotion_id', type: 'uuid' },
          { name: 'user_id', type: 'uuid' },
          { name: 'subscription_id', type: 'uuid' },
          { name: 'code_snapshot', type: 'varchar', length: '64' },
          {
            name: 'redemption_context',
            type: 'enum',
            enumName: 'promotion_redemption_context_enum',
          },
          {
            name: 'status',
            type: 'enum',
            enumName: 'promotion_redemption_status_enum',
            default: "'active'",
          },
          { name: 'redeemed_at', type: 'timestamp' },
          { name: 'benefit_starts_at', type: 'timestamp' },
          { name: 'benefit_ends_at', type: 'timestamp', isNullable: true },
          { name: 'remaining_amount_net', type: 'numeric', precision: 12, scale: 4, isNullable: true },
          { name: 'remaining_billing_periods', type: 'int', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['promotion_id'],
            referencedTableName: 'billing_promotions',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          }),
          new TableForeignKey({
            columnNames: ['subscription_id'],
            referencedTableName: 'billing_subscriptions',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
        ],
        indices: [
          new TableIndex({
            name: 'IDX_billing_promotion_redemptions_user_promotion',
            columnNames: ['user_id', 'promotion_id'],
          }),
          new TableIndex({
            name: 'IDX_billing_promotion_redemptions_subscription_status',
            columnNames: ['subscription_id', 'status'],
          }),
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_invoice_promotion_applications',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'invoice_id', type: 'uuid' },
          { name: 'redemption_id', type: 'uuid' },
          { name: 'amount_applied_net', type: 'numeric', precision: 12, scale: 4, default: 0 },
          { name: 'periods_consumed', type: 'int', default: 0 },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['invoice_id'],
            referencedTableName: 'billing_invoices',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
          new TableForeignKey({
            columnNames: ['redemption_id'],
            referencedTableName: 'billing_promotion_redemptions',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          }),
        ],
        indices: [
          new TableIndex({ name: 'IDX_billing_invoice_promotion_applications_invoice', columnNames: ['invoice_id'] }),
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('billing_invoice_promotion_applications', true);
    await queryRunner.dropTable('billing_promotion_redemptions', true);
    await queryRunner.dropTable('billing_promotions', true);
    await queryRunner.query('DROP TYPE IF EXISTS "promotion_redemption_status_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "promotion_redemption_context_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "promotion_subscription_eligibility_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "promotion_advantage_type_enum"');
  }
}
