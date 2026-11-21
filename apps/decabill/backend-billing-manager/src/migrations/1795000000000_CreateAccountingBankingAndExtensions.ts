import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Accounting extensions: financial accounts with file / processor-API imports (statements, normalized
 * transactions with layered dedupe, CSV mappings, learned match rules), VAT returns, the fixed asset register,
 * account assignment on supplier lines, moving-average inventory valuation, ISO 11649 payment references on
 * invoices and selectable e-invoice formats (issuer default, customer override, snapshot on the invoice).
 */
export class CreateAccountingBankingAndExtensions1795000000000 implements MigrationInterface {
  name = 'CreateAccountingBankingAndExtensions1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_financial_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NULL,
        "name" character varying(255) NOT NULL,
        "kind" character varying(16) NOT NULL,
        "iban" character varying(34) NULL,
        "account_number" character varying(64) NULL,
        "bic" character varying(11) NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'EUR',
        "ledger_account_number" character varying(20) NOT NULL,
        "processor" character varying(32) NULL,
        "last_closing_balance" numeric(14,2) NULL,
        "last_closing_date" date NULL,
        "sync_cursor" character varying(255) NULL,
        "last_synced_at" TIMESTAMP NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_financial_accounts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_financial_accounts_iban"
      ON "billing_accounting_financial_accounts" ("iban")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_financial_accounts_iban_currency"
      ON "billing_accounting_financial_accounts" ("iban", "currency") WHERE "iban" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_bank_imports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NULL,
        "financial_account_id" uuid NULL,
        "file_name" character varying(255) NOT NULL,
        "file_sha256" character varying(64) NOT NULL,
        "file_size" integer NOT NULL,
        "storage_key" character varying(512) NULL,
        "format" character varying(64) NULL,
        "format_version" character varying(16) NULL,
        "encoding" character varying(16) NULL,
        "csv_mapping" character varying(64) NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "statement_count" integer NOT NULL DEFAULT 0,
        "transaction_count" integer NOT NULL DEFAULT 0,
        "duplicate_count" integer NOT NULL DEFAULT 0,
        "matched_count" integer NOT NULL DEFAULT 0,
        "warnings" jsonb NOT NULL DEFAULT '[]',
        "error_message" text NULL,
        "uploaded_by_user_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP NULL,
        CONSTRAINT "PK_billing_accounting_bank_imports" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_bank_imports_hash" ON "billing_accounting_bank_imports" ("file_sha256")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_bank_statements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "import_id" uuid NOT NULL,
        "financial_account_id" uuid NOT NULL,
        "kind" character varying(24) NOT NULL,
        "statement_ref" character varying(128) NULL,
        "sequence_number" character varying(64) NULL,
        "period_from" date NULL,
        "period_to" date NULL,
        "opening_balance" numeric(14,2) NULL,
        "closing_balance" numeric(14,2) NULL,
        "currency" character varying(3) NULL,
        "warnings" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_bank_statements" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_accounting_bank_statements_import" FOREIGN KEY ("import_id")
          REFERENCES "billing_accounting_bank_imports" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_accounting_bank_statements_account" FOREIGN KEY ("financial_account_id")
          REFERENCES "billing_accounting_financial_accounts" ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_bank_statements_account"
      ON "billing_accounting_bank_statements" ("financial_account_id", "period_to")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_bank_transactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "financial_account_id" uuid NOT NULL,
        "import_id" uuid NOT NULL,
        "statement_id" uuid NULL,
        "tenant_id" character varying(64) NULL,
        "status" character varying(8) NOT NULL,
        "booking_date" date NOT NULL,
        "value_date" date NULL,
        "amount" numeric(14,2) NOT NULL,
        "currency" character varying(3) NOT NULL,
        "is_reversal" boolean NOT NULL DEFAULT false,
        "counterparty_name" character varying(255) NULL,
        "counterparty_iban" character varying(34) NULL,
        "counterparty_bic" character varying(11) NULL,
        "remittance" text NULL,
        "end_to_end_id" character varying(128) NULL,
        "structured_reference" character varying(64) NULL,
        "booking_text" character varying(255) NULL,
        "bank_reference" character varying(128) NULL,
        "bank_transaction_code" character varying(64) NULL,
        "details" jsonb NOT NULL DEFAULT '[]',
        "raw" text NULL,
        "locator" character varying(255) NULL,
        "dedupe_key" character varying(64) NOT NULL,
        "dedupe_ordinal" integer NOT NULL DEFAULT 0,
        "source_format" character varying(16) NULL,
        "match_status" character varying(16) NOT NULL DEFAULT 'unmatched',
        "suggestion" jsonb NULL,
        "journal_entry_id" uuid NULL,
        "matched_by_user_id" uuid NULL,
        "matched_at" TIMESTAMP NULL,
        "superseded_by_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_bank_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_accounting_bank_transactions_account" FOREIGN KEY ("financial_account_id")
          REFERENCES "billing_accounting_financial_accounts" ("id"),
        CONSTRAINT "FK_billing_accounting_bank_transactions_import" FOREIGN KEY ("import_id")
          REFERENCES "billing_accounting_bank_imports" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_bank_transactions_dedupe"
      ON "billing_accounting_bank_transactions" ("financial_account_id", "dedupe_key", "dedupe_ordinal")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_bank_transactions_status"
      ON "billing_accounting_bank_transactions" ("financial_account_id", "match_status", "booking_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_bank_transactions_e2e"
      ON "billing_accounting_bank_transactions" ("end_to_end_id") WHERE "end_to_end_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_bank_transactions_booking"
      ON "billing_accounting_bank_transactions" ("financial_account_id", "booking_date")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_csv_mappings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NULL,
        "name" character varying(255) NOT NULL,
        "mapping" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_csv_mappings" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_match_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" character varying(8) NOT NULL,
        "pattern" character varying(128) NOT NULL,
        "target_type" character varying(16) NOT NULL,
        "target_id" character varying(64) NOT NULL,
        "tax_code" character varying(64) NULL,
        "hits" integer NOT NULL DEFAULT 0,
        "created_by_user_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_match_rules" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_match_rules" ON "billing_accounting_match_rules" ("kind", "pattern")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_vat_returns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "definition_key" character varying(32) NOT NULL,
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'draft',
        "vat_basis" character varying(16) NOT NULL,
        "figures" jsonb NOT NULL,
        "details" jsonb NOT NULL DEFAULT '[]',
        "manual_values" jsonb NOT NULL DEFAULT '{}',
        "result_amount" numeric(14,2) NULL,
        "computed_at" TIMESTAMP NOT NULL,
        "submitted_at" TIMESTAMP NULL,
        "submitted_by_user_id" uuid NULL,
        "filing_reference" character varying(128) NULL,
        "payment_entry_id" uuid NULL,
        "note" text NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_vat_returns" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_vat_returns_period"
      ON "billing_accounting_vat_returns" ("definition_key", "period_start", "period_end")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_fixed_assets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NULL,
        "asset_number" character varying(32) NOT NULL,
        "name" character varying(255) NOT NULL,
        "acquisition_date" date NOT NULL,
        "acquisition_cost" numeric(14,2) NOT NULL,
        "method" character varying(16) NOT NULL,
        "useful_life_months" integer NOT NULL,
        "asset_account_number" character varying(20) NOT NULL,
        "residual_value" numeric(14,2) NOT NULL DEFAULT 0,
        "accumulated_depreciation" numeric(14,2) NOT NULL DEFAULT 0,
        "depreciated_through" character varying(7) NULL,
        "status" character varying(24) NOT NULL DEFAULT 'active',
        "supplier_invoice_id" uuid NULL,
        "supplier_invoice_line_id" uuid NULL,
        "inventory_serial_unit_id" uuid NULL,
        "disposal_date" date NULL,
        "disposal_proceeds" numeric(14,2) NULL,
        "note" text NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_fixed_assets" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_accounting_fixed_assets_cost" CHECK ("acquisition_cost" >= 0 AND "useful_life_months" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_fixed_assets_number" ON "billing_accounting_fixed_assets" ("asset_number")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_fixed_assets_supplier_line"
      ON "billing_accounting_fixed_assets" ("supplier_invoice_line_id") WHERE "supplier_invoice_line_id" IS NOT NULL
    `);

    // Account assignment (Kontierung) and capitalization on supplier invoices.
    await queryRunner.query(`
      ALTER TABLE "billing_supplier_profiles"
        ADD COLUMN IF NOT EXISTS "default_expense_account_number" character varying(20) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_supplier_invoice_line_items"
        ADD COLUMN IF NOT EXISTS "ledger_account_number" character varying(20) NULL,
        ADD COLUMN IF NOT EXISTS "capitalize_as_asset" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "asset_useful_life_months" integer NULL,
        ADD COLUMN IF NOT EXISTS "inventory_article_id" uuid NULL
    `);

    // Moving-average inventory valuation.
    await queryRunner.query(`
      ALTER TABLE "billing_inventory_articles"
        ADD COLUMN IF NOT EXISTS "average_cost" numeric(14,4) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_inventory_movements"
        ADD COLUMN IF NOT EXISTS "unit_cost" numeric(14,4) NULL,
        ADD COLUMN IF NOT EXISTS "total_cost" numeric(14,2) NULL,
        ADD COLUMN IF NOT EXISTS "supplier_invoice_id" uuid NULL
    `);

    // ISO 11649 structured payment reference and e-invoice format selection.
    await queryRunner.query(`
      ALTER TABLE "billing_invoices"
        ADD COLUMN IF NOT EXISTS "payment_reference" character varying(25) NULL,
        ADD COLUMN IF NOT EXISTS "einvoice_format" character varying(32) NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_invoices_payment_reference"
      ON "billing_invoices" ("payment_reference") WHERE "payment_reference" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
        ADD COLUMN IF NOT EXISTS "einvoice_format" character varying(32) NULL,
        ADD COLUMN IF NOT EXISTS "buyer_reference" character varying(64) NULL,
        ADD COLUMN IF NOT EXISTS "einvoice_endpoint" character varying(140) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "einvoice_format", DROP COLUMN IF EXISTS "buyer_reference",
        DROP COLUMN IF EXISTS "einvoice_endpoint"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_billing_invoices_payment_reference"`);
    await queryRunner.query(`
      ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "payment_reference", DROP COLUMN IF EXISTS "einvoice_format"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_inventory_movements"
        DROP COLUMN IF EXISTS "unit_cost", DROP COLUMN IF EXISTS "total_cost", DROP COLUMN IF EXISTS "supplier_invoice_id"
    `);
    await queryRunner.query(`ALTER TABLE "billing_inventory_articles" DROP COLUMN IF EXISTS "average_cost"`);
    await queryRunner.query(`
      ALTER TABLE "billing_supplier_invoice_line_items"
        DROP COLUMN IF EXISTS "ledger_account_number", DROP COLUMN IF EXISTS "capitalize_as_asset",
        DROP COLUMN IF EXISTS "asset_useful_life_months", DROP COLUMN IF EXISTS "inventory_article_id"
    `);
    await queryRunner.query(
      `ALTER TABLE "billing_supplier_profiles" DROP COLUMN IF EXISTS "default_expense_account_number"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_fixed_assets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_vat_returns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_match_rules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_csv_mappings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_bank_transactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_bank_statements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_bank_imports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_financial_accounts"`);
  }
}
