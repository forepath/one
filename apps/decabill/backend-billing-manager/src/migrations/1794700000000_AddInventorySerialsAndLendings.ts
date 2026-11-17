import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inventory serial numbers and lendings: articles can require serial numbers (one unit row per serial number),
 * movements record the serial numbers they moved and the lending they belong to, and lendings track stock on loan
 * to customers or staff until it is returned. Existing articles keep serial tracking off; existing rows are untouched.
 */
export class AddInventorySerialsAndLendings1794700000000 implements MigrationInterface {
  name = 'AddInventorySerialsAndLendings1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_inventory_articles"
      ADD COLUMN IF NOT EXISTS "serial_tracking" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_inventory_lendings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NOT NULL DEFAULT 'default',
        "article_id" uuid NOT NULL,
        "document_number" character varying(32) NULL,
        "quantity" numeric(14,3) NOT NULL,
        "returned_quantity" numeric(14,3) NOT NULL DEFAULT 0,
        "status" character varying(16) NOT NULL,
        "borrower_user_id" uuid NULL,
        "borrower_name" character varying(255) NOT NULL,
        "borrower_email" character varying(255) NULL,
        "borrower_customer_number" character varying(32) NULL,
        "borrower_kind" character varying(16) NOT NULL,
        "source_compartment_id" uuid NOT NULL,
        "due_date" date NULL,
        "note" text NULL,
        "lent_by_user_id" uuid NULL,
        "returned_at" TIMESTAMP NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_inventory_lendings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_inventory_lendings_article" FOREIGN KEY ("article_id")
          REFERENCES "billing_inventory_articles" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_billing_inventory_lendings_source" FOREIGN KEY ("source_compartment_id")
          REFERENCES "billing_inventory_compartments" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_billing_inventory_lendings_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_billing_inventory_lendings_returned" CHECK ("returned_quantity" >= 0 AND "returned_quantity" <= "quantity"),
        CONSTRAINT "CHK_billing_inventory_lendings_status" CHECK ("status" IN ('open', 'returned')),
        CONSTRAINT "CHK_billing_inventory_lendings_borrower_kind" CHECK ("borrower_kind" IN ('customer', 'staff'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_lendings_status"
      ON "billing_inventory_lendings" ("tenant_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_lendings_article" ON "billing_inventory_lendings" ("article_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_lendings_borrower"
      ON "billing_inventory_lendings" ("borrower_user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_inventory_serial_units" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" character varying(64) NOT NULL DEFAULT 'default',
        "article_id" uuid NOT NULL,
        "serial_number" character varying(128) NOT NULL,
        "status" character varying(16) NOT NULL,
        "compartment_id" uuid NULL,
        "lending_id" uuid NULL,
        "last_movement_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_inventory_serial_units" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_inventory_serial_units_status" CHECK (
          ("status" = 'in_stock' AND "compartment_id" IS NOT NULL AND "lending_id" IS NULL)
          OR ("status" = 'lent' AND "compartment_id" IS NULL AND "lending_id" IS NOT NULL)
          OR ("status" = 'withdrawn' AND "compartment_id" IS NULL AND "lending_id" IS NULL)
        ),
        CONSTRAINT "FK_billing_inventory_serial_units_article" FOREIGN KEY ("article_id")
          REFERENCES "billing_inventory_articles" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_billing_inventory_serial_units_compartment" FOREIGN KEY ("compartment_id")
          REFERENCES "billing_inventory_compartments" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_billing_inventory_serial_units_lending" FOREIGN KEY ("lending_id")
          REFERENCES "billing_inventory_lendings" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_inventory_serial_units_article_serial"
      ON "billing_inventory_serial_units" ("tenant_id", "article_id", "serial_number")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_serial_units_location"
      ON "billing_inventory_serial_units" ("article_id", "compartment_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_serial_units_lending"
      ON "billing_inventory_serial_units" ("lending_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_inventory_movements"
      ADD COLUMN IF NOT EXISTS "serial_numbers" jsonb NULL,
      ADD COLUMN IF NOT EXISTS "lending_id" uuid NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_inventory_movements_lending"
      ON "billing_inventory_movements" ("lending_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_inventory_movements"
      DROP CONSTRAINT IF EXISTS "FK_billing_inventory_movements_lending",
      ADD CONSTRAINT "FK_billing_inventory_movements_lending" FOREIGN KEY ("lending_id")
        REFERENCES "billing_inventory_lendings" ("id") ON DELETE RESTRICT
    `);

    // Lending documents take stock out (source), returns put it back (target); both belong to a lending.
    await queryRunner.query(`
      ALTER TABLE "billing_inventory_movements"
      DROP CONSTRAINT IF EXISTS "CHK_billing_inventory_movements_type",
      DROP CONSTRAINT IF EXISTS "CHK_billing_inventory_movements_locations",
      ADD CONSTRAINT "CHK_billing_inventory_movements_type"
        CHECK ("type" IN ('putaway', 'transfer', 'withdrawal', 'lending', 'lending_return')),
      ADD CONSTRAINT "CHK_billing_inventory_movements_locations" CHECK (
        ("type" = 'putaway' AND "source_compartment_id" IS NULL AND "target_compartment_id" IS NOT NULL)
        OR ("type" = 'transfer' AND "source_compartment_id" IS NOT NULL AND "target_compartment_id" IS NOT NULL
            AND "source_compartment_id" <> "target_compartment_id")
        OR ("type" = 'withdrawal' AND "source_compartment_id" IS NOT NULL AND "target_compartment_id" IS NULL)
        OR ("type" = 'lending' AND "source_compartment_id" IS NOT NULL AND "target_compartment_id" IS NULL
            AND "lending_id" IS NOT NULL)
        OR ("type" = 'lending_return' AND "source_compartment_id" IS NULL AND "target_compartment_id" IS NOT NULL
            AND "lending_id" IS NOT NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Lending documents cannot be represented without these columns.
    await queryRunner.query(`DELETE FROM "billing_inventory_movements" WHERE "type" IN ('lending', 'lending_return')`);
    await queryRunner.query(`
      ALTER TABLE "billing_inventory_movements"
      DROP CONSTRAINT IF EXISTS "CHK_billing_inventory_movements_type",
      DROP CONSTRAINT IF EXISTS "CHK_billing_inventory_movements_locations",
      DROP CONSTRAINT IF EXISTS "FK_billing_inventory_movements_lending",
      ADD CONSTRAINT "CHK_billing_inventory_movements_type" CHECK ("type" IN ('putaway', 'transfer', 'withdrawal')),
      ADD CONSTRAINT "CHK_billing_inventory_movements_locations" CHECK (
        ("type" = 'putaway' AND "source_compartment_id" IS NULL AND "target_compartment_id" IS NOT NULL)
        OR ("type" = 'transfer' AND "source_compartment_id" IS NOT NULL AND "target_compartment_id" IS NOT NULL
            AND "source_compartment_id" <> "target_compartment_id")
        OR ("type" = 'withdrawal' AND "source_compartment_id" IS NOT NULL AND "target_compartment_id" IS NULL)
      )
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_billing_inventory_movements_lending"`);
    await queryRunner.query(`
      ALTER TABLE "billing_inventory_movements" DROP COLUMN IF EXISTS "lending_id", DROP COLUMN IF EXISTS "serial_numbers"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_inventory_serial_units"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_inventory_lendings"`);
    await queryRunner.query(`ALTER TABLE "billing_inventory_articles" DROP COLUMN IF EXISTS "serial_tracking"`);
  }
}
