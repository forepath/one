import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Documents can reach the customer by email, as a physical letter through a postal provider (Pingen) or outside
 * Decabill (marked as sent manually). `sent_via` records the channel next to each `sent_at`; every document sent
 * before this migration was emailed, so the existing timestamps are backfilled with `email`.
 *
 * `billing_postal_letters` tracks each letter at the provider. It carries the tenant explicitly because provider
 * webhooks arrive without tenant context and are resolved through (provider, external_id).
 *
 * `billing_spool_jobs` is the central spooler: admin-triggered printouts (labels, movement documents, time reports)
 * and document sends (email, letter) run as tracked background jobs; `billing_spool_job_outputs` keeps the generated
 * files for download until the retention period ends.
 */
export class AddPostalDelivery1795400000000 implements MigrationInterface {
  name = 'AddPostalDelivery1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "billing_invoices" ADD COLUMN IF NOT EXISTS "sent_via" varchar(16) NULL`);
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" ADD COLUMN IF NOT EXISTS "void_document_sent_via" varchar(16) NULL`,
    );
    await queryRunner.query(`ALTER TABLE "billing_offers" ADD COLUMN IF NOT EXISTS "sent_via" varchar(16) NULL`);
    await queryRunner.query(
      `UPDATE "billing_invoices" SET "sent_via" = 'email' WHERE "sent_at" IS NOT NULL AND "sent_via" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "billing_invoices" SET "void_document_sent_via" = 'email'
       WHERE "void_document_sent_at" IS NOT NULL AND "void_document_sent_via" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "billing_offers" SET "sent_via" = 'email' WHERE "sent_at" IS NOT NULL AND "sent_via" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_postal_letters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" varchar(64) NOT NULL,
        "user_id" uuid NOT NULL,
        "document_type" varchar(16) NOT NULL,
        "document_id" uuid NOT NULL,
        "document_number" varchar(64) NULL,
        "provider" varchar(64) NOT NULL,
        "external_id" varchar(255) NOT NULL,
        "status" varchar(32) NOT NULL,
        "status_reason" varchar(500) NULL,
        "claimed_at" TIMESTAMP NOT NULL,
        "cover_page" boolean NOT NULL DEFAULT false,
        "page_count" int NULL,
        "country" varchar(2) NULL,
        "created_by_user_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_postal_letters" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_billing_postal_letters_provider_external"
       ON "billing_postal_letters" ("provider", "external_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_billing_postal_letters_document"
       ON "billing_postal_letters" ("document_type", "document_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_billing_postal_letters_tenant_status"
       ON "billing_postal_letters" ("tenant_id", "status")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_spool_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" varchar(64) NOT NULL,
        "kind" varchar(64) NOT NULL,
        "status" varchar(16) NOT NULL,
        "output_target" varchar(16) NOT NULL,
        "title" varchar(255) NOT NULL,
        "payload" jsonb NOT NULL,
        "document_type" varchar(16) NULL,
        "document_id" uuid NULL,
        "attempts" int NOT NULL DEFAULT 0,
        "error" varchar(500) NULL,
        "file_name" varchar(255) NULL,
        "content_type" varchar(100) NULL,
        "file_size" int NULL,
        "created_by_user_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "started_at" TIMESTAMP NULL,
        "finished_at" TIMESTAMP NULL,
        CONSTRAINT "PK_billing_spool_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_billing_spool_jobs_tenant_created" ON "billing_spool_jobs" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_billing_spool_jobs_status_updated" ON "billing_spool_jobs" ("status", "updated_at")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_spool_job_outputs" (
        "job_id" uuid NOT NULL,
        "content" bytea NOT NULL,
        CONSTRAINT "PK_billing_spool_job_outputs" PRIMARY KEY ("job_id"),
        CONSTRAINT "FK_billing_spool_job_outputs_job" FOREIGN KEY ("job_id")
          REFERENCES "billing_spool_jobs" ("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_spool_job_outputs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_spool_jobs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_postal_letters"`);
    await queryRunner.query(`ALTER TABLE "billing_offers" DROP COLUMN IF EXISTS "sent_via"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "void_document_sent_via"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "sent_via"`);
  }
}
