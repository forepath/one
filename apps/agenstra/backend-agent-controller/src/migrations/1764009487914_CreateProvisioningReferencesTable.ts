import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Migration to create the provisioning_references table.
 * Stores references to cloud provider server instances linked to clients.
 * Sets a foreign key to clients(id) with CASCADE on delete and update.
 */
export class CreateProvisioningReferencesTable1764009487914 implements MigrationInterface {
  name = 'CreateProvisioningReferencesTable1764009487914';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'provisioning_references',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'client_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'provider_type',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'server_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'server_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'public_ip',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'private_ip',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'provider_metadata',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Unique constraint on (provider_type, server_id) to prevent duplicate server references
    await queryRunner.createUniqueConstraint(
      'provisioning_references',
      new TableUnique({
        name: 'uq_provider_server',
        columnNames: ['provider_type', 'server_id'],
      }),
    );

    // Foreign key to clients table
    await queryRunner.createForeignKey(
      'provisioning_references',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'clients',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      }),
    );

    // Indexes for lookups
    await queryRunner.createIndex(
      'provisioning_references',
      new TableIndex({
        name: 'IDX_provisioning_references_client_id',
        columnNames: ['client_id'],
      }),
    );
    await queryRunner.createIndex(
      'provisioning_references',
      new TableIndex({
        name: 'IDX_provisioning_references_provider_type',
        columnNames: ['provider_type'],
      }),
    );
    await queryRunner.createIndex(
      'provisioning_references',
      new TableIndex({
        name: 'IDX_provisioning_references_server_id',
        columnNames: ['server_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('provisioning_references', 'IDX_provisioning_references_server_id');
    await queryRunner.dropIndex('provisioning_references', 'IDX_provisioning_references_provider_type');
    await queryRunner.dropIndex('provisioning_references', 'IDX_provisioning_references_client_id');
    // Drop FK
    const table = await queryRunner.getTable('provisioning_references');
    const foreignKey = table?.foreignKeys.find((fk) => fk.columnNames.indexOf('client_id') !== -1);

    if (foreignKey) {
      await queryRunner.dropForeignKey('provisioning_references', foreignKey);
    }

    // Drop unique
    await queryRunner.dropUniqueConstraint('provisioning_references', 'uq_provider_server');
    // Drop table
    await queryRunner.dropTable('provisioning_references');
  }
}
