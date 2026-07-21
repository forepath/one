import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerProfileTrustScore1774400000000 implements MigrationInterface {
  name = 'AddCustomerProfileTrustScore1774400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
      ADD COLUMN IF NOT EXISTS "trust_score" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
      ADD COLUMN IF NOT EXISTS "trust_level" character varying(16)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles"
      ADD COLUMN IF NOT EXISTS "trust_score_updated_at" TIMESTAMP
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_billing_customer_profiles_trust_level"
      ON "billing_customer_profiles" ("trust_level")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_billing_customer_profiles_trust_level"`);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "trust_score_updated_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "trust_level"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_customer_profiles" DROP COLUMN IF EXISTS "trust_score"
    `);
  }
}
