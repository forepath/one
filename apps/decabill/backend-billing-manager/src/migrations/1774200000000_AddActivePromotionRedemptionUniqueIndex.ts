import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActivePromotionRedemptionUniqueIndex1774200000000 implements MigrationInterface {
  name = 'AddActivePromotionRedemptionUniqueIndex1774200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_promotion_redemptions_active_sub_promo"
      ON "billing_promotion_redemptions" ("subscription_id", "promotion_id")
      WHERE "status" = 'active';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_billing_promotion_redemptions_active_sub_promo";
    `);
  }
}
