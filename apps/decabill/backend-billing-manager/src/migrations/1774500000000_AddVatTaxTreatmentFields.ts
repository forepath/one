import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVatTaxTreatmentFields1774500000000 implements MigrationInterface {
  name = 'AddVatTaxTreatmentFields1774500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "customer_type_enum" AS ENUM ('business', 'consumer');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "vat_id_validation_status_enum" AS ENUM (
          'none', 'pending', 'valid', 'invalid', 'unavailable'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "vat_id_validation_source_enum" AS ENUM (
          'vies_sync', 'vies_async', 'admin', 'format_only'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "tax_mode_enum" AS ENUM (
          'domestic_vat',
          'eu_reverse_charge',
          'eu_b2c_oss',
          'third_country_b2b_no_vat',
          'third_country_b2c_no_domestic_vat',
          'non_eu_issuer_eu_b2b',
          'non_eu_issuer_eu_b2c'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
      ADD COLUMN IF NOT EXISTS "customer_type" character varying(16)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
      ADD COLUMN IF NOT EXISTS "vat_id" character varying(32)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
      ADD COLUMN IF NOT EXISTS "vat_id_validation_status" character varying(16)
      NOT NULL DEFAULT 'none'
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
      ADD COLUMN IF NOT EXISTS "vat_id_validated_at" TIMESTAMP
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
      ADD COLUMN IF NOT EXISTS "vat_id_validation_source" character varying(16)
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "tax_mode" character varying(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "tax_country_code" character varying(2)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "tax_note" text
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "einvoice_tax_category_code" character varying(8)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "resolved_tax_rate" numeric(8,4)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "buyer_vat_id" character varying(32)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "buyer_country" character varying(2)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "buyer_customer_type" character varying(16)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "issuer_country" character varying(2)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
      ADD COLUMN IF NOT EXISTS "issuer_is_in_eu" boolean
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_oss_threshold_ledgers" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" character varying(64) NOT NULL DEFAULT 'unified',
        "calendar_year" integer NOT NULL,
        "cross_border_b2c_net_total" numeric(14,4) NOT NULL DEFAULT 0,
        "threshold_eur" numeric(14,4) NOT NULL DEFAULT 10000,
        "threshold_exceeded_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uq_billing_oss_threshold_ledgers_tenant_year"
          UNIQUE ("tenant_id", "calendar_year")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_oss_threshold_ledgers"`);

    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "issuer_is_in_eu"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "issuer_country"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "buyer_customer_type"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "buyer_country"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "buyer_vat_id"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "resolved_tax_rate"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "einvoice_tax_category_code"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "tax_note"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "tax_country_code"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "tax_mode"`);

    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "vat_id_validation_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "vat_id_validated_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "vat_id_validation_status"
    `);
    await queryRunner.query(`ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "vat_id"`);
    await queryRunner.query(`ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "customer_type"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "tax_mode_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vat_id_validation_source_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vat_id_validation_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "customer_type_enum"`);
  }
}
