import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddYearlyIntervalAndBillInAdvance1774600000000 implements MigrationInterface {
  name = 'AddYearlyIntervalAndBillInAdvance1774600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "billing_interval_type_enum" RENAME TO "billing_interval_type_enum_old"`);
    await queryRunner.query(`CREATE TYPE "billing_interval_type_enum" AS ENUM ('hour', 'day', 'month', 'year')`);
    await queryRunner.query(
      `ALTER TABLE "billing_service_plans" ALTER COLUMN "billing_interval_type" TYPE "billing_interval_type_enum" USING "billing_interval_type"::text::"billing_interval_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "billing_interval_type_enum_old"`);

    await queryRunner.query(`
      ALTER TABLE "billing_service_plans"
      ADD COLUMN "bill_in_advance" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "billing_service_plans" SET "billing_interval_type" = 'month' WHERE "billing_interval_type" = 'year'
    `);
    await queryRunner.query(`ALTER TABLE "billing_service_plans" DROP COLUMN "bill_in_advance"`);

    await queryRunner.query(`ALTER TYPE "billing_interval_type_enum" RENAME TO "billing_interval_type_enum_old"`);
    await queryRunner.query(`CREATE TYPE "billing_interval_type_enum" AS ENUM ('hour', 'day', 'month')`);
    await queryRunner.query(
      `ALTER TABLE "billing_service_plans" ALTER COLUMN "billing_interval_type" TYPE "billing_interval_type_enum" USING "billing_interval_type"::text::"billing_interval_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "billing_interval_type_enum_old"`);
  }
}
