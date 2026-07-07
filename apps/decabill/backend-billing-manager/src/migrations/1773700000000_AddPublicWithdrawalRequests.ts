import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class AddPublicWithdrawalRequests1773700000000 implements MigrationInterface {
  name = 'AddPublicWithdrawalRequests1773700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'billing_public_withdrawal_requests',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'subscription_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'confirmation_code',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: false,
          },
          {
            name: 'code_verified_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'confirmed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'billing_public_withdrawal_requests',
      new TableForeignKey({
        columnNames: ['subscription_id'],
        referencedTableName: 'billing_subscriptions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'billing_public_withdrawal_requests',
      new TableIndex({
        name: 'IDX_billing_public_withdrawal_requests_subscription_id',
        columnNames: ['subscription_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('billing_public_withdrawal_requests');
  }
}
