import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPendingWithdrawalStatus1773500000000 implements MigrationInterface {
  name = 'AddPendingWithdrawalStatus1773500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "subscription_status_enum" RENAME TO "subscription_status_enum_old"`);
    await queryRunner.query(
      `CREATE TYPE "subscription_status_enum" AS ENUM ('active', 'pending_backorder', 'pending_cancel', 'pending_withdrawal', 'canceled')`,
    );
    await queryRunner.query(`ALTER TABLE "billing_subscriptions" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "billing_subscriptions" ALTER COLUMN "status" TYPE "subscription_status_enum" USING "status"::text::"subscription_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "billing_subscriptions" ALTER COLUMN "status" SET DEFAULT 'active'`);
    await queryRunner.query(`DROP TYPE "subscription_status_enum_old"`);

    await queryRunner.addColumn(
      'billing_subscriptions',
      new TableColumn({
        name: 'withdraw_phase',
        type: 'varchar',
        length: '30',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_subscriptions', 'withdraw_phase');

    await queryRunner.query(
      `UPDATE "billing_subscriptions" SET "status" = 'canceled' WHERE "status" = 'pending_withdrawal'`,
    );
    await queryRunner.query(`ALTER TYPE "subscription_status_enum" RENAME TO "subscription_status_enum_old"`);
    await queryRunner.query(
      `CREATE TYPE "subscription_status_enum" AS ENUM ('active', 'pending_backorder', 'pending_cancel', 'canceled')`,
    );
    await queryRunner.query(`ALTER TABLE "billing_subscriptions" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "billing_subscriptions" ALTER COLUMN "status" TYPE "subscription_status_enum" USING "status"::text::"subscription_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "billing_subscriptions" ALTER COLUMN "status" SET DEFAULT 'active'`);
    await queryRunner.query(`DROP TYPE "subscription_status_enum_old"`);
  }
}
