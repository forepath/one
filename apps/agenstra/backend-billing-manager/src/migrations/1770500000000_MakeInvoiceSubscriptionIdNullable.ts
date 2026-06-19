import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeInvoiceSubscriptionIdNullable1770500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "billing_invoices" ALTER COLUMN "subscription_id" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "billing_invoices" SET "subscription_id" = (
        SELECT s.id FROM billing_subscriptions s WHERE s.user_id = billing_invoices.user_id LIMIT 1
      ) WHERE "subscription_id" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "billing_invoices" ALTER COLUMN "subscription_id" SET NOT NULL`);
  }
}
