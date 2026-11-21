import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Finalizing and sending documents are separate steps: an offer can be archived, an invoice issued and a credit note
 * created without emailing the customer, and sent later. `sent_at` records when the customer was emailed the
 * document; visibility in the customer's account does not depend on it.
 * `notify_on_expiry` decides whether the customer is emailed when an archived offer expires.
 *
 * Every document finalized before this migration was sent in the same step, so the timestamps are backfilled from
 * the finalize timestamps. Existing offers keep their previous behaviour on expiry (no email).
 */
export class AddDocumentDelivery1795100000000 implements MigrationInterface {
  name = 'AddDocumentDelivery1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "billing_offers" ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP NULL`);
    await queryRunner.query(
      `ALTER TABLE "billing_offers" ADD COLUMN IF NOT EXISTS "notify_on_expiry" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "billing_offers" SET "sent_at" = "archived_at" WHERE "archived_at" IS NOT NULL AND "sent_at" IS NULL`,
    );

    await queryRunner.query(`ALTER TABLE "billing_invoices" ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP NULL`);
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" ADD COLUMN IF NOT EXISTS "void_document_sent_at" TIMESTAMP NULL`,
    );
    await queryRunner.query(
      `UPDATE "billing_invoices" SET "sent_at" = "issued_at" WHERE "issued_at" IS NOT NULL AND "sent_at" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "billing_invoices" SET "void_document_sent_at" = "voided_at"
       WHERE "status" = 'void' AND "voided_at" IS NOT NULL AND "void_document_sent_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "void_document_sent_at"`);
    await queryRunner.query(`ALTER TABLE "billing_invoices" DROP COLUMN IF EXISTS "sent_at"`);
    await queryRunner.query(`ALTER TABLE "billing_offers" DROP COLUMN IF EXISTS "notify_on_expiry"`);
    await queryRunner.query(`ALTER TABLE "billing_offers" DROP COLUMN IF EXISTS "sent_at"`);
  }
}
