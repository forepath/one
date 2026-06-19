import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderingHighlightsToServicePlans1770100000000 implements MigrationInterface {
  name = 'AddOrderingHighlightsToServicePlans1770100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_service_plans"
      ADD COLUMN "ordering_highlights" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_service_plans" DROP COLUMN "ordering_highlights"
    `);
  }
}
