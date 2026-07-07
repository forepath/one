import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllowCustomerServerTypeSelectionToServicePlans1773900000000 implements MigrationInterface {
  name = 'AddAllowCustomerServerTypeSelectionToServicePlans1773900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_service_plans"
      ADD COLUMN "allow_customer_server_type_selection" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_service_plans"
      ADD COLUMN "allowed_server_types" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_service_plans" DROP COLUMN "allowed_server_types"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_service_plans" DROP COLUMN "allow_customer_server_type_selection"
    `);
  }
}
