import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customers (and admins on their behalf) choose how documents reach them: `email` (default) or `letter`, which posts
 * documents through the tenant's postal provider in addition to the email. Such supplementary letters are tracked
 * like other letters but never take over the document's sent state, which belongs to the email.
 */
export class AddCustomerPreferredDelivery1795500000000 implements MigrationInterface {
  name = 'AddCustomerPreferredDelivery1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_customer_profiles"
       ADD COLUMN IF NOT EXISTS "preferred_delivery_channel" varchar(16) NOT NULL DEFAULT 'email'`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_postal_letters" ADD COLUMN IF NOT EXISTS "supplementary" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "billing_postal_letters" DROP COLUMN IF EXISTS "supplementary"`);
    await queryRunner.query(
      `ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "preferred_delivery_channel"`,
    );
  }
}
