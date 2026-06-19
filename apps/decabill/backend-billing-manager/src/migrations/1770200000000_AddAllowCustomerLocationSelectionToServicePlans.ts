import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllowCustomerLocationSelectionToServicePlans1770200000000 implements MigrationInterface {
  name = 'AddAllowCustomerLocationSelectionToServicePlans1770200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_service_plans"
      ADD COLUMN "allow_customer_location_selection" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_service_plans" DROP COLUMN "allow_customer_location_selection"
    `);
  }
}
