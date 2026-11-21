import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Settlements: every payment, credit, refund, write-off and customer-credit transfer of a customer or supplier
 * invoice becomes a row, and balance / status are derived from them. Adds the `credited` and `written_off`
 * statuses and the VAT snapshot of partial credit notes.
 *
 * Backfill (`source = migration`) keeps existing balances unchanged: credit notes become CREDIT settlements capped
 * at the amount the invoice balance actually went down, the remaining settled amount of paid invoices becomes one
 * PAYMENT at `paid_at`. Statuses of existing documents are not rewritten.
 */
export class CreateDocumentSettlements1794800000000 implements MigrationInterface {
  name = 'CreateDocumentSettlements1794800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "invoice_status_enum" ADD VALUE IF NOT EXISTS 'credited'`);
    await queryRunner.query(`ALTER TYPE "invoice_status_enum" ADD VALUE IF NOT EXISTS 'written_off'`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_document_settlements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "document_type" character varying(24) NOT NULL,
        "document_id" uuid NOT NULL,
        "type" character varying(24) NOT NULL,
        "amount" numeric(12,4) NOT NULL,
        "currency" character varying(10) NOT NULL,
        "occurred_at" TIMESTAMP NOT NULL,
        "source" character varying(24) NOT NULL,
        "source_ref" character varying(191) NOT NULL,
        "processor" character varying(50) NULL,
        "external_id" character varying(255) NULL,
        "payment_attempt_id" uuid NULL,
        "credit_document_id" uuid NULL,
        "payment_refund_id" uuid NULL,
        "bank_transaction_id" uuid NULL,
        "related_document_id" uuid NULL,
        "reverses_settlement_id" uuid NULL,
        "note" character varying(500) NULL,
        "created_by_user_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_document_settlements" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_document_settlements_amount" CHECK ("amount" > 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_document_settlements_source"
      ON "billing_document_settlements" ("document_type", "document_id", "type", "source_ref")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_document_settlements_document"
      ON "billing_document_settlements" ("document_type", "document_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_invoice_credit_documents"
        ADD COLUMN IF NOT EXISTS "credit_tax" numeric(12,4) NULL,
        ADD COLUMN IF NOT EXISTS "tax_rate" numeric(8,4) NULL
    `);
    await queryRunner.query(`
      UPDATE "billing_invoice_credit_documents"
      SET "credit_tax" = ROUND("credit_gross" - "credit_net", 2)
      WHERE "credit_tax" IS NULL
    `);

    // Credit notes: capped at what the invoice balance went down by (any excess was carried forward as an open
    // position under the old logic and must not become customer credit as well).
    await queryRunner.query(`
      INSERT INTO "billing_document_settlements"
        ("document_type", "document_id", "type", "amount", "currency", "occurred_at", "source", "source_ref",
         "credit_document_id")
      SELECT 'invoice', c."invoice_id", 'credit',
             LEAST(c."credit_gross", GREATEST(i."total_gross" - i."balance_due", 0)),
             i."currency", c."withdrawn_at", 'migration', 'credit:' || c."id", c."id"
      FROM "billing_invoice_credit_documents" c
      JOIN "billing_invoices" i ON i."id" = c."invoice_id"
      WHERE i."status" NOT IN ('draft', 'void')
        AND LEAST(c."credit_gross", GREATEST(i."total_gross" - i."balance_due", 0)) > 0
      ON CONFLICT DO NOTHING
    `);

    // Remaining settled amount of customer invoices = cash payment.
    await queryRunner.query(`
      INSERT INTO "billing_document_settlements"
        ("document_type", "document_id", "type", "amount", "currency", "occurred_at", "source", "source_ref",
         "processor", "external_id")
      SELECT 'invoice', i."id", 'payment',
             ROUND(i."total_gross" - i."balance_due" - COALESCE(s."credited", 0), 4),
             i."currency", COALESCE(i."paid_at", i."issued_at", i."created_at"), 'migration', 'migration:payment',
             i."payment_processor", i."external_payment_id"
      FROM "billing_invoices" i
      LEFT JOIN (
        SELECT "document_id", SUM("amount") AS "credited"
        FROM "billing_document_settlements"
        WHERE "document_type" = 'invoice' AND "type" = 'credit'
        GROUP BY "document_id"
      ) s ON s."document_id" = i."id"
      WHERE i."status" NOT IN ('draft', 'void')
        AND i."total_gross" - i."balance_due" - COALESCE(s."credited", 0) > 0.004
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "billing_document_settlements"
        ("document_type", "document_id", "type", "amount", "currency", "occurred_at", "source", "source_ref")
      SELECT 'supplier_invoice', si."id", 'payment', ROUND(si."total_gross" - si."balance_due", 4), si."currency",
             COALESCE(si."paid_at", si."issued_at", si."created_at"), 'migration', 'migration:payment'
      FROM "billing_supplier_invoices" si
      WHERE si."status" NOT IN ('draft', 'void')
        AND si."total_gross" - si."balance_due" > 0.004
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_document_settlements"`);
    await queryRunner.query(`
      ALTER TABLE "billing_invoice_credit_documents"
        DROP COLUMN IF EXISTS "credit_tax",
        DROP COLUMN IF EXISTS "tax_rate"
    `);
    // Enum values cannot be dropped in PostgreSQL; `credited` / `written_off` stay defined.
  }
}
