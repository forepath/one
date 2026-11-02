import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Effective teardown time of a cancelled subscription when it is later than `cancel_effective_at` (Loadweaver teardown
 * grace period). The expiration queue filters on `COALESCE(teardown_not_before, cancel_effective_at)`, so cancelled
 * Loadweaver clusters in their grace period no longer occupy `EXPIRATION_SCHEDULER_BATCH_SIZE` slots.
 */
export class AddSubscriptionTeardownNotBefore1778400000000 implements MigrationInterface {
  name = 'AddSubscriptionTeardownNotBefore1778400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "teardown_not_before" TIMESTAMP NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "billing_subscriptions" DROP COLUMN IF EXISTS "teardown_not_before"`);
  }
}
