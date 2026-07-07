import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatutoryWithdrawalSupport1773300000000 implements MigrationInterface {
  name = 'AddStatutoryWithdrawalSupport1773300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_service_types"
      ADD COLUMN "disallow_statutory_withdrawal" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_subscription_items"
      ADD COLUMN "provisioned_at" TIMESTAMP NULL
    `);

    await queryRunner.query(`
      UPDATE "billing_subscription_items"
      SET "provisioned_at" = "updated_at"
      WHERE "provisioning_status" = 'active' AND "provisioned_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "billing_subscriptions"
      ADD COLUMN "withdrawn_at" TIMESTAMP NULL
    `);

    await queryRunner.query(`
      CREATE TYPE "payment_refund_status_enum" AS ENUM ('pending', 'succeeded', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE "billing_invoice_credit_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoice_id" uuid NOT NULL,
        "document_number" varchar(64) NOT NULL,
        "credit_net" decimal(12,4) NOT NULL,
        "credit_gross" decimal(12,4) NOT NULL,
        "pdf_storage_key" varchar(512) NOT NULL,
        "reason" varchar(50) NOT NULL DEFAULT 'withdrawal',
        "withdrawn_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_invoice_credit_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_invoice_credit_documents_invoice"
          FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_invoice_credit_documents_invoice_id"
      ON "billing_invoice_credit_documents" ("invoice_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "billing_payment_refunds" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoice_id" uuid NOT NULL,
        "amount" decimal(12,4) NOT NULL,
        "currency" varchar(10) NOT NULL DEFAULT 'EUR',
        "processor" varchar(50) NOT NULL,
        "external_refund_id" varchar(255) NULL,
        "status" "payment_refund_status_enum" NOT NULL DEFAULT 'pending',
        "reason" varchar(50) NOT NULL DEFAULT 'withdrawal',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_payment_refunds" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_payment_refunds_invoice"
          FOREIGN KEY ("invoice_id") REFERENCES "billing_invoices"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_billing_payment_refunds_invoice_id"
      ON "billing_payment_refunds" ("invoice_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "billing_payment_refunds"`);
    await queryRunner.query(`DROP TYPE "payment_refund_status_enum"`);
    await queryRunner.query(`DROP TABLE "billing_invoice_credit_documents"`);
    await queryRunner.query(`ALTER TABLE "billing_subscriptions" DROP COLUMN "withdrawn_at"`);
    await queryRunner.query(`ALTER TABLE "billing_subscription_items" DROP COLUMN "provisioned_at"`);
    await queryRunner.query(`ALTER TABLE "billing_service_types" DROP COLUMN "disallow_statutory_withdrawal"`);
  }
}
