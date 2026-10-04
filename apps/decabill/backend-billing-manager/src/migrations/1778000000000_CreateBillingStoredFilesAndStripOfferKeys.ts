import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates billing_stored_files registry and backfills rows from domain storage keys
 * using the customer/supplier/export scope layout. Strips offers/ prefix from offer keys.
 */
export class CreateBillingStoredFilesAndStripOfferKeys1778000000000 implements MigrationInterface {
  name = 'CreateBillingStoredFilesAndStripOfferKeys1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_stored_files" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "long_sha" character varying(40) NOT NULL,
        "tenant_id" character varying(64) NOT NULL,
        "scope" character varying(64) NOT NULL,
        "storage_key" character varying(512) NOT NULL,
        "content_md5" character varying(32),
        "content_sha1" character varying(40),
        "content_sha256" character varying(64),
        "content_sha512" character varying(128),
        "byte_size" bigint,
        "signature" character varying(64),
        "signature_alg" character varying(32),
        "signature_version" character varying(8),
        "signed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_stored_files" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_billing_stored_files_scope_key"
      ON "billing_stored_files" ("scope", "storage_key")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_stored_files_long_sha"
      ON "billing_stored_files" ("long_sha")
    `);

    await queryRunner.query(`
      UPDATE "billing_offers"
      SET "pdf_storage_key" = substring("pdf_storage_key" from 8)
      WHERE "pdf_storage_key" LIKE 'offers/%'
    `);

    await queryRunner.query(`
      INSERT INTO "billing_stored_files" ("id", "long_sha", "tenant_id", "scope", "storage_key")
      SELECT gen_random_uuid(), '', u.tenant_id, 'customerInvoices', i.pdf_storage_key
      FROM "billing_invoices" i
      INNER JOIN "users" u ON u.id = i.user_id
      WHERE i.pdf_storage_key IS NOT NULL
      ON CONFLICT ("scope", "storage_key") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "billing_stored_files" ("id", "long_sha", "tenant_id", "scope", "storage_key")
      SELECT gen_random_uuid(), '', u.tenant_id, 'customerTimesheets', i.time_report_storage_key
      FROM "billing_invoices" i
      INNER JOIN "users" u ON u.id = i.user_id
      WHERE i.time_report_storage_key IS NOT NULL
      ON CONFLICT ("scope", "storage_key") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "billing_stored_files" ("id", "long_sha", "tenant_id", "scope", "storage_key")
      SELECT gen_random_uuid(), '', u.tenant_id, 'customerInvoices', d.pdf_storage_key
      FROM "billing_invoice_void_documents" d
      INNER JOIN "billing_invoices" i ON i.id = d.invoice_id
      INNER JOIN "users" u ON u.id = i.user_id
      ON CONFLICT ("scope", "storage_key") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "billing_stored_files" ("id", "long_sha", "tenant_id", "scope", "storage_key")
      SELECT gen_random_uuid(), '', u.tenant_id, 'customerInvoices', d.pdf_storage_key
      FROM "billing_invoice_credit_documents" d
      INNER JOIN "billing_invoices" i ON i.id = d.invoice_id
      INNER JOIN "users" u ON u.id = i.user_id
      ON CONFLICT ("scope", "storage_key") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "billing_stored_files" ("id", "long_sha", "tenant_id", "scope", "storage_key")
      SELECT gen_random_uuid(), '', u.tenant_id, 'customerOffers', o.pdf_storage_key
      FROM "billing_offers" o
      INNER JOIN "users" u ON u.id = o.user_id
      WHERE o.pdf_storage_key IS NOT NULL
      ON CONFLICT ("scope", "storage_key") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "billing_stored_files" ("id", "long_sha", "tenant_id", "scope", "storage_key")
      SELECT gen_random_uuid(), '', sp.tenant_id, 'supplierInvoices', si.document_storage_key
      FROM "billing_supplier_invoices" si
      INNER JOIN "billing_supplier_profiles" sp ON sp.id = si.supplier_id
      WHERE si.document_storage_key IS NOT NULL
      ON CONFLICT ("scope", "storage_key") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "billing_stored_files" ("id", "long_sha", "tenant_id", "scope", "storage_key")
      SELECT gen_random_uuid(), '', de.tenant_id, 'datevExports', de.storage_key
      FROM "billing_datev_exports" de
      WHERE de.storage_key IS NOT NULL
      ON CONFLICT ("scope", "storage_key") DO NOTHING
    `);

    await queryRunner.query(`
      UPDATE "billing_stored_files"
      SET "long_sha" = encode(digest("id"::text, 'sha1'), 'hex')
      WHERE "long_sha" = '' OR "long_sha" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "billing_offers"
      SET "pdf_storage_key" = 'offers/' || "pdf_storage_key"
      WHERE "pdf_storage_key" IS NOT NULL
        AND "pdf_storage_key" NOT LIKE 'offers/%'
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "billing_stored_files"`);
  }
}
