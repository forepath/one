import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inventory: warehouses with storage compartments, articles (numbered `ART-{nnnnnn}`), article placements with
 * on-hand quantities, numbered movement documents (putaway / transfer / withdrawal) and withdrawal requests raised
 * by offers, invoices and subscriptions. Offer lines gain the `article` line type; offer lines, invoice lines and
 * service plans can reference articles. Existing rows are untouched (new columns are nullable).
 */
export class CreateInventoryTables1794600000000 implements MigrationInterface {
  name = 'CreateInventoryTables1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_inventory_number_sequences" (
        "scope_key" character varying(64) NOT NULL,
        "kind" character varying(8) NOT NULL,
        "year" integer NOT NULL,
        "last_value" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_billing_inventory_number_sequences" PRIMARY KEY ("scope_key", "kind", "year")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_inventory_warehouses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NOT NULL DEFAULT 'default',
        "code" character varying(32) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text NULL,
        "address_line1" character varying(255) NULL,
        "address_line2" character varying(255) NULL,
        "postal_code" character varying(32) NULL,
        "city" character varying(255) NULL,
        "country" character varying(2) NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_inventory_warehouses" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_inventory_warehouses_tenant_code"
      ON "billing_inventory_warehouses" ("tenant_id", "code")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_inventory_compartments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NOT NULL DEFAULT 'default',
        "warehouse_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "name" character varying(255) NULL,
        "description" text NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_inventory_compartments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_inventory_compartments_warehouse" FOREIGN KEY ("warehouse_id")
          REFERENCES "billing_inventory_warehouses" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_inventory_compartments_warehouse_code"
      ON "billing_inventory_compartments" ("warehouse_id", "code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_compartments_tenant"
      ON "billing_inventory_compartments" ("tenant_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_inventory_articles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NOT NULL DEFAULT 'default',
        "article_number" character varying(32) NOT NULL,
        "number_scope" character varying(64) NOT NULL DEFAULT '__shared__',
        "name" character varying(255) NOT NULL,
        "description" text NULL,
        "ean" character varying(14) NULL,
        "unit" character varying(16) NOT NULL DEFAULT 'piece',
        "manufacturer" character varying(255) NULL,
        "manufacturer_part_number" character varying(128) NULL,
        "supplier_id" uuid NULL,
        "supplier_article_number" character varying(128) NULL,
        "purchase_price_net" numeric(12,4) NULL,
        "sales_price_net" numeric(12,4) NULL,
        "currency" character varying(10) NOT NULL DEFAULT 'EUR',
        "tax_category" character varying(32) NOT NULL DEFAULT 'standard',
        "reorder_point" numeric(14,3) NULL,
        "reorder_quantity" numeric(14,3) NULL,
        "weight_kg" numeric(12,4) NULL,
        "length_cm" numeric(10,2) NULL,
        "width_cm" numeric(10,2) NULL,
        "height_cm" numeric(10,2) NULL,
        "hs_code" character varying(16) NULL,
        "country_of_origin" character varying(2) NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_inventory_articles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_inventory_articles_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "billing_supplier_profiles" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_inventory_articles_number_scope_number"
      ON "billing_inventory_articles" ("number_scope", "article_number")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_articles_tenant_ean"
      ON "billing_inventory_articles" ("tenant_id", "ean")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_inventory_stock" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NOT NULL DEFAULT 'default',
        "compartment_id" uuid NOT NULL,
        "article_id" uuid NOT NULL,
        "quantity" numeric(14,3) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_inventory_stock" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_inventory_stock_quantity" CHECK ("quantity" >= 0),
        CONSTRAINT "FK_billing_inventory_stock_compartment" FOREIGN KEY ("compartment_id")
          REFERENCES "billing_inventory_compartments" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_inventory_stock_article" FOREIGN KEY ("article_id")
          REFERENCES "billing_inventory_articles" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_inventory_stock_compartment_article"
      ON "billing_inventory_stock" ("compartment_id", "article_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_stock_article" ON "billing_inventory_stock" ("article_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_inventory_withdrawal_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NOT NULL DEFAULT 'default',
        "article_id" uuid NOT NULL,
        "quantity" numeric(14,3) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "source_type" character varying(16) NOT NULL,
        "source_ref" character varying(255) NOT NULL,
        "source_label" character varying(255) NOT NULL,
        "user_id" uuid NULL,
        "offer_id" uuid NULL,
        "invoice_id" uuid NULL,
        "subscription_id" uuid NULL,
        "decided_at" TIMESTAMP NULL,
        "decided_by_user_id" uuid NULL,
        "decision_note" text NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_inventory_withdrawal_requests" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_inventory_withdrawal_requests_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_billing_inventory_withdrawal_requests_status"
          CHECK ("status" IN ('pending', 'accepted', 'rejected')),
        CONSTRAINT "CHK_billing_inventory_withdrawal_requests_source"
          CHECK ("source_type" IN ('offer', 'invoice', 'subscription')),
        CONSTRAINT "FK_billing_inventory_withdrawal_requests_article" FOREIGN KEY ("article_id")
          REFERENCES "billing_inventory_articles" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_inventory_withdrawal_requests_source_ref"
      ON "billing_inventory_withdrawal_requests" ("source_ref")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_withdrawal_requests_tenant_status"
      ON "billing_inventory_withdrawal_requests" ("tenant_id", "status", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_inventory_movements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NOT NULL DEFAULT 'default',
        "type" character varying(16) NOT NULL,
        "document_number" character varying(32) NOT NULL,
        "number_scope" character varying(64) NOT NULL DEFAULT '__shared__',
        "article_id" uuid NOT NULL,
        "quantity" numeric(14,3) NOT NULL,
        "reason" character varying(16) NULL,
        "source_compartment_id" uuid NULL,
        "target_compartment_id" uuid NULL,
        "source_quantity_after" numeric(14,3) NULL,
        "target_quantity_after" numeric(14,3) NULL,
        "snapshot" jsonb NOT NULL,
        "reference" character varying(255) NULL,
        "note" text NULL,
        "withdrawal_request_id" uuid NULL,
        "performed_by_user_id" uuid NULL,
        "pdf_storage_key" character varying(512) NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_inventory_movements" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_inventory_movements_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_billing_inventory_movements_type" CHECK ("type" IN ('putaway', 'transfer', 'withdrawal')),
        CONSTRAINT "CHK_billing_inventory_movements_locations" CHECK (
          ("type" = 'putaway' AND "source_compartment_id" IS NULL AND "target_compartment_id" IS NOT NULL)
          OR ("type" = 'transfer' AND "source_compartment_id" IS NOT NULL AND "target_compartment_id" IS NOT NULL
              AND "source_compartment_id" <> "target_compartment_id")
          OR ("type" = 'withdrawal' AND "source_compartment_id" IS NOT NULL AND "target_compartment_id" IS NULL)
        ),
        CONSTRAINT "FK_billing_inventory_movements_article" FOREIGN KEY ("article_id")
          REFERENCES "billing_inventory_articles" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_billing_inventory_movements_request" FOREIGN KEY ("withdrawal_request_id")
          REFERENCES "billing_inventory_withdrawal_requests" ("id") ON DELETE SET NULL
      )
    `);
    // Compartments may be deleted once empty; movement documents keep their location snapshot.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_inventory_movements_number_scope_number"
      ON "billing_inventory_movements" ("number_scope", "document_number")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_movements_tenant_created"
      ON "billing_inventory_movements" ("tenant_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_movements_article"
      ON "billing_inventory_movements" ("article_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_movements_request"
      ON "billing_inventory_movements" ("withdrawal_request_id")
    `);

    await queryRunner.query(`ALTER TYPE "offer_line_type_enum" ADD VALUE IF NOT EXISTS 'article'`);
    await queryRunner.query(
      `ALTER TABLE "billing_offer_line_items" ADD COLUMN IF NOT EXISTS "inventory_article_id" uuid NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_invoice_line_items" ADD COLUMN IF NOT EXISTS "inventory_article_id" uuid NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_service_plans" ADD COLUMN IF NOT EXISTS "inventory_articles" jsonb NULL`,
    );

    for (const table of ['billing_offer_line_items', 'billing_invoice_line_items']) {
      await queryRunner.query(`
        DO $$ BEGIN
          ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_inventory_article" FOREIGN KEY ("inventory_article_id")
            REFERENCES "billing_inventory_articles" ("id") ON DELETE SET NULL;
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['billing_invoice_line_items', 'billing_offer_line_items']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_inventory_article"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "inventory_article_id"`);
    }

    await queryRunner.query(`ALTER TABLE "billing_service_plans" DROP COLUMN IF EXISTS "inventory_articles"`);
    // Postgres cannot drop a single enum value; article lines become standard lines instead.
    await queryRunner.query(
      `UPDATE "billing_offer_line_items" SET "line_type" = 'standard' WHERE "line_type"::text = 'article'`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_inventory_movements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_inventory_withdrawal_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_inventory_stock"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_inventory_articles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_inventory_compartments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_inventory_warehouses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_inventory_number_sequences"`);
  }
}
