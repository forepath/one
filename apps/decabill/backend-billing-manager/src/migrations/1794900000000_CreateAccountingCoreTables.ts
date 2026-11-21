import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Accounting core: charts of accounts (from country templates or built from scratch), tax codes with VAT return
 * boxes, fiscal years with monthly periods (locking = Festschreibung), the gap-free numbered journal with its
 * lines, links between bookings and any document/transaction, exchange rates and failed-posting issues.
 * Journal rows are append-only (enforced by triggers): corrections are reversal entries.
 */
export class CreateAccountingCoreTables1794900000000 implements MigrationInterface {
  name = 'CreateAccountingCoreTables1794900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_charts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying(32) NOT NULL,
        "name" character varying(255) NOT NULL,
        "country" character varying(2) NULL,
        "template_key" character varying(32) NULL,
        "account_length" integer NOT NULL DEFAULT 4,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_charts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_charts_code" ON "billing_accounting_charts" ("code")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_tax_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "chart_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(255) NOT NULL,
        "kind" character varying(16) NOT NULL,
        "rate" numeric(8,4) NULL,
        "account_id" uuid NULL,
        "reverse_account_id" uuid NULL,
        "base_box" character varying(16) NULL,
        "tax_box" character varying(16) NULL,
        "reverse_tax_box" character varying(16) NULL,
        "ec_sales_list" boolean NOT NULL DEFAULT false,
        "oss" boolean NOT NULL DEFAULT false,
        "datev_bu_key" character varying(4) NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_tax_codes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_accounting_tax_codes_chart" FOREIGN KEY ("chart_id")
          REFERENCES "billing_accounting_charts" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_tax_codes_chart_code"
      ON "billing_accounting_tax_codes" ("chart_id", "code")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "chart_id" uuid NOT NULL,
        "number" character varying(20) NOT NULL,
        "name" character varying(255) NOT NULL,
        "type" character varying(16) NOT NULL,
        "role" character varying(48) NULL,
        "statement_position" character varying(64) NULL,
        "is_automatic" boolean NOT NULL DEFAULT false,
        "default_tax_code_id" uuid NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "is_template" boolean NOT NULL DEFAULT false,
        "description" text NULL,
        "external_codes" jsonb NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_accounting_accounts_chart" FOREIGN KEY ("chart_id")
          REFERENCES "billing_accounting_charts" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_accounting_accounts_tax_code" FOREIGN KEY ("default_tax_code_id")
          REFERENCES "billing_accounting_tax_codes" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_accounts_chart_number"
      ON "billing_accounting_accounts" ("chart_id", "number")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_accounts_chart_role"
      ON "billing_accounting_accounts" ("chart_id", "role") WHERE "role" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_accounts_chart" ON "billing_accounting_accounts" ("chart_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_accounting_tax_codes"
        ADD CONSTRAINT "FK_billing_accounting_tax_codes_account" FOREIGN KEY ("account_id")
          REFERENCES "billing_accounting_accounts" ("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_billing_accounting_tax_codes_reverse_account" FOREIGN KEY ("reverse_account_id")
          REFERENCES "billing_accounting_accounts" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_fiscal_years" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(32) NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "chart_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'open',
        "closed_at" TIMESTAMP NULL,
        "closed_by_user_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_fiscal_years" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_accounting_fiscal_years_chart" FOREIGN KEY ("chart_id")
          REFERENCES "billing_accounting_charts" ("id"),
        CONSTRAINT "CHK_billing_accounting_fiscal_years_range" CHECK ("end_date" >= "start_date")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_fiscal_years_start"
      ON "billing_accounting_fiscal_years" ("start_date")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_periods" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fiscal_year_id" uuid NOT NULL,
        "period_index" integer NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'open',
        "locked_at" TIMESTAMP NULL,
        "locked_by_user_id" uuid NULL,
        CONSTRAINT "PK_billing_accounting_periods" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_accounting_periods_year" FOREIGN KEY ("fiscal_year_id")
          REFERENCES "billing_accounting_fiscal_years" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_periods_year_index"
      ON "billing_accounting_periods" ("fiscal_year_id", "period_index")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_entry_number_sequences" (
        "fiscal_year_id" uuid NOT NULL,
        "last_value" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_billing_accounting_entry_number_sequences" PRIMARY KEY ("fiscal_year_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_journal_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fiscal_year_id" uuid NOT NULL,
        "period_id" uuid NOT NULL,
        "entry_number" integer NOT NULL,
        "posting_date" date NOT NULL,
        "document_date" date NOT NULL,
        "document_number" character varying(64) NULL,
        "description" character varying(255) NOT NULL,
        "kind" character varying(24) NOT NULL,
        "source_type" character varying(32) NOT NULL,
        "source_id" character varying(64) NULL,
        "source_event" character varying(48) NULL,
        "idempotency_key" character varying(191) NOT NULL,
        "tenant_id" character varying(64) NULL,
        "currency" character varying(3) NOT NULL,
        "fx_rate" numeric(18,8) NOT NULL DEFAULT 1,
        "total" numeric(14,2) NOT NULL,
        "reversal_of_entry_id" uuid NULL,
        "reversed_by_entry_id" uuid NULL,
        "created_by_user_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_journal_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_accounting_journal_entries_year" FOREIGN KEY ("fiscal_year_id")
          REFERENCES "billing_accounting_fiscal_years" ("id"),
        CONSTRAINT "FK_billing_accounting_journal_entries_period" FOREIGN KEY ("period_id")
          REFERENCES "billing_accounting_periods" ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_journal_entries_year_number"
      ON "billing_accounting_journal_entries" ("fiscal_year_id", "entry_number")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_journal_entries_idempotency"
      ON "billing_accounting_journal_entries" ("idempotency_key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_journal_entries_source"
      ON "billing_accounting_journal_entries" ("source_type", "source_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_journal_entries_posting_date"
      ON "billing_accounting_journal_entries" ("posting_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_journal_entries_tenant"
      ON "billing_accounting_journal_entries" ("tenant_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_journal_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "entry_id" uuid NOT NULL,
        "line_no" integer NOT NULL,
        "account_id" uuid NOT NULL,
        "debit" numeric(14,2) NOT NULL DEFAULT 0,
        "credit" numeric(14,2) NOT NULL DEFAULT 0,
        "original_amount" numeric(14,4) NULL,
        "original_currency" character varying(3) NULL,
        "tax_code_id" uuid NULL,
        "tax_rate" numeric(8,4) NULL,
        "tax_role" character varying(16) NULL,
        "counterparty_type" character varying(16) NULL,
        "counterparty_id" character varying(64) NULL,
        "open_item_id" uuid NULL,
        "tenant_id" character varying(64) NULL,
        "cost_center" character varying(32) NULL,
        "description" character varying(255) NULL,
        "service_date" date NULL,
        "eu_country" character varying(2) NULL,
        "eu_vat_id" character varying(32) NULL,
        CONSTRAINT "PK_billing_accounting_journal_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_accounting_journal_lines_entry" FOREIGN KEY ("entry_id")
          REFERENCES "billing_accounting_journal_entries" ("id"),
        CONSTRAINT "FK_billing_accounting_journal_lines_account" FOREIGN KEY ("account_id")
          REFERENCES "billing_accounting_accounts" ("id"),
        CONSTRAINT "CHK_billing_accounting_journal_lines_side"
          CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0 OR "credit" = 0))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_journal_lines_entry" ON "billing_accounting_journal_lines" ("entry_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_journal_lines_account" ON "billing_accounting_journal_lines" ("account_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_journal_lines_counterparty"
      ON "billing_accounting_journal_lines" ("counterparty_type", "counterparty_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_journal_lines_open_item"
      ON "billing_accounting_journal_lines" ("open_item_id")
    `);

    // GoBD: posted bookings are immutable. Only the reversal back-reference may be set (once) on entries.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION billing_accounting_journal_immutable() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Journal rows are immutable (use a reversal entry)';
        END IF;
        IF TG_TABLE_NAME = 'billing_accounting_journal_entries' THEN
          IF OLD.reversed_by_entry_id IS NULL AND NEW.reversed_by_entry_id IS NOT NULL
             AND ROW(NEW.fiscal_year_id, NEW.period_id, NEW.entry_number, NEW.posting_date, NEW.document_date,
                     NEW.document_number, NEW.description, NEW.total, NEW.idempotency_key)
                 IS NOT DISTINCT FROM
                 ROW(OLD.fiscal_year_id, OLD.period_id, OLD.entry_number, OLD.posting_date, OLD.document_date,
                     OLD.document_number, OLD.description, OLD.total, OLD.idempotency_key) THEN
            RETURN NEW;
          END IF;
        END IF;
        RAISE EXCEPTION 'Journal rows are immutable (use a reversal entry)';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_billing_accounting_journal_entries_immutable" ON "billing_accounting_journal_entries"
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_billing_accounting_journal_entries_immutable"
      BEFORE UPDATE OR DELETE ON "billing_accounting_journal_entries"
      FOR EACH ROW EXECUTE FUNCTION billing_accounting_journal_immutable()
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_billing_accounting_journal_lines_immutable" ON "billing_accounting_journal_lines"
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_billing_accounting_journal_lines_immutable"
      BEFORE UPDATE OR DELETE ON "billing_accounting_journal_lines"
      FOR EACH ROW EXECUTE FUNCTION billing_accounting_journal_immutable()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_entry_links" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "entry_id" uuid NOT NULL,
        "link_type" character varying(32) NOT NULL,
        "target_id" character varying(64) NOT NULL,
        "role" character varying(16) NOT NULL,
        "label" character varying(255) NULL,
        "created_by_user_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_entry_links" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_accounting_entry_links_entry" FOREIGN KEY ("entry_id")
          REFERENCES "billing_accounting_journal_entries" ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_entry_links"
      ON "billing_accounting_entry_links" ("entry_id", "link_type", "target_id", "role")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_accounting_entry_links_target"
      ON "billing_accounting_entry_links" ("link_type", "target_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_fx_rates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "currency" character varying(3) NOT NULL,
        "rate_date" date NOT NULL,
        "rate" numeric(18,8) NOT NULL,
        "source" character varying(16) NOT NULL,
        "created_by_user_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_fx_rates" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_accounting_fx_rates_positive" CHECK ("rate" > 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_fx_rates"
      ON "billing_accounting_fx_rates" ("currency", "rate_date", "source")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounting_posting_issues" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "idempotency_key" character varying(191) NOT NULL,
        "source_type" character varying(32) NOT NULL,
        "source_id" character varying(64) NOT NULL,
        "source_event" character varying(48) NOT NULL,
        "tenant_id" character varying(64) NULL,
        "error" text NOT NULL,
        "attempts" integer NOT NULL DEFAULT 1,
        "resolved_at" TIMESTAMP NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounting_posting_issues" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_accounting_posting_issues_key"
      ON "billing_accounting_posting_issues" ("idempotency_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_posting_issues"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_fx_rates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_entry_links"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_journal_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_journal_entries"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS billing_accounting_journal_immutable()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_entry_number_sequences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_periods"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_fiscal_years"`);
    await queryRunner.query(
      `ALTER TABLE IF EXISTS "billing_accounting_tax_codes" DROP CONSTRAINT IF EXISTS "FK_billing_accounting_tax_codes_account"`,
    );
    await queryRunner.query(
      `ALTER TABLE IF EXISTS "billing_accounting_tax_codes" DROP CONSTRAINT IF EXISTS "FK_billing_accounting_tax_codes_reverse_account"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_accounts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_tax_codes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounting_charts"`);
  }
}
