import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableUnique } from 'typeorm';

export class AddReservedHostnamesAndItemHostname1767800000000 implements MigrationInterface {
  name = 'AddReservedHostnamesAndItemHostname1767800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_subscription_items',
      new TableColumn({
        name: 'hostname',
        type: 'varchar',
        length: '128',
        isNullable: true,
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'billing_reserved_hostnames',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'hostname', type: 'varchar', length: '128', isUnique: true },
          { name: 'subscription_item_id', type: 'uuid' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'billing_reserved_hostnames',
      new TableForeignKey({
        columnNames: ['subscription_item_id'],
        referencedTableName: 'billing_subscription_items',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'billing_reserved_hostnames',
      new TableUnique({
        name: 'UQ_billing_reserved_hostnames_subscription_item_id',
        columnNames: ['subscription_item_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('billing_reserved_hostnames', true);
    await queryRunner.dropColumn('billing_subscription_items', 'hostname');
  }
}
