import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaxCategoryToServicePlansAndCreditDocuments1774000000000 implements MigrationInterface {
  name = 'AddTaxCategoryToServicePlansAndCreditDocuments1774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_service_plans"
      ADD COLUMN "tax_category" "tax_category_enum" NOT NULL DEFAULT 'standard'
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoice_credit_documents"
      ADD COLUMN "tax_category" "tax_category_enum" NOT NULL DEFAULT 'standard'
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoice_credit_documents"
      ADD COLUMN "description" varchar(255) NOT NULL DEFAULT ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_invoice_credit_documents" DROP COLUMN "description"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_invoice_credit_documents" DROP COLUMN "tax_category"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_service_plans" DROP COLUMN "tax_category"
    `);
  }
}
