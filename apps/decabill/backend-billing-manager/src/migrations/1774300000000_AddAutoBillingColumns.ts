import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutoBillingColumns1774300000000 implements MigrationInterface {
  name = 'AddAutoBillingColumns1774300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
      ADD COLUMN IF NOT EXISTS "auto_billing_enabled" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
      ADD COLUMN IF NOT EXISTS "default_payment_method_external_id" character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "auto_payment_status" character varying(32) NOT NULL DEFAULT 'idle'
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "auto_payment_attempt_count" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "auto_payment_next_retry_at" TIMESTAMP
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_invoices_auto_payment_due"
      ON "billing_invoices" ("auto_payment_status", "auto_payment_next_retry_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_billing_invoices_auto_payment_due"`);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "auto_payment_next_retry_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "auto_payment_attempt_count"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "auto_payment_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "default_payment_method_external_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "auto_billing_enabled"
    `);
  }
}
