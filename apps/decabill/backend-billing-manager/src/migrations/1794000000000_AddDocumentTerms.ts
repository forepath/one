import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payment terms (payable within N days) and delivery terms (Incoterms® 2020 rule + named place, or CUSTOM free text).
 * Service plans and offers carry optional overrides (null = inherit the global default); invoices and archived
 * offers carry the resolved terms frozen at issuance / archive. Existing rows stay null, so documents issued before
 * this migration render exactly as before.
 */
export class AddDocumentTerms1794000000000 implements MigrationInterface {
  name = 'AddDocumentTerms1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['billing_service_plans', 'billing_offers', 'billing_invoices']) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ADD COLUMN IF NOT EXISTS "payment_due_days" integer NULL,
        ADD COLUMN IF NOT EXISTS "delivery_terms_code" character varying(16) NULL,
        ADD COLUMN IF NOT EXISTS "delivery_terms_place" character varying(255) NULL,
        ADD COLUMN IF NOT EXISTS "delivery_terms_text" text NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['billing_invoices', 'billing_offers', 'billing_service_plans']) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
        DROP COLUMN IF EXISTS "delivery_terms_text",
        DROP COLUMN IF EXISTS "delivery_terms_place",
        DROP COLUMN IF EXISTS "delivery_terms_code",
        DROP COLUMN IF EXISTS "payment_due_days"
      `);
    }
  }
}
