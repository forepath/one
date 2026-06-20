import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds ssh_private_key to billing_subscription_items.
 * Stores the SSH private key (for server access) encrypted at rest via application-level GCM transformer.
 */
export class AddSshPrivateKeyToSubscriptionItems1767900000000 implements MigrationInterface {
  name = 'AddSshPrivateKeyToSubscriptionItems1767900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_subscription_items',
      new TableColumn({
        name: 'ssh_private_key',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_subscription_items', 'ssh_private_key');
  }
}
