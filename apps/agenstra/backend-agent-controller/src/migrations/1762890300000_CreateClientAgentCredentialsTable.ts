import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Migration to create the client_agent_credentials table.
 * Stores credentials returned when creating agents through proxied requests.
 * Sets a foreign key to clients(id) with CASCADE on delete and update.
 */
export class CreateClientAgentCredentialsTable1762890300000 implements MigrationInterface {
  name = 'CreateClientAgentCredentialsTable1762890300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'client_agent_credentials',
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
            name: 'agent_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'password',
            type: 'varchar',
            length: '255',
            isNullable: false,
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

    // Unique constraint on (client_id, agent_id)
    await queryRunner.createUniqueConstraint(
      'client_agent_credentials',
      new TableUnique({
        name: 'uq_client_agent',
        columnNames: ['client_id', 'agent_id'],
      }),
    );

    // Foreign key to clients table
    await queryRunner.createForeignKey(
      'client_agent_credentials',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'clients',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      }),
    );

    // Index useful for lookups
    await queryRunner.createIndex(
      'client_agent_credentials',
      new TableIndex({
        name: 'IDX_client_agent_credentials_client_id',
        columnNames: ['client_id'],
      }),
    );
    await queryRunner.createIndex(
      'client_agent_credentials',
      new TableIndex({
        name: 'IDX_client_agent_credentials_agent_id',
        columnNames: ['agent_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('client_agent_credentials', 'IDX_client_agent_credentials_agent_id');
    await queryRunner.dropIndex('client_agent_credentials', 'IDX_client_agent_credentials_client_id');
    // Drop FK
    const table = await queryRunner.getTable('client_agent_credentials');
    const foreignKey = table?.foreignKeys.find((fk) => fk.columnNames.indexOf('client_id') !== -1);

    if (foreignKey) {
      await queryRunner.dropForeignKey('client_agent_credentials', foreignKey);
    }

    // Drop unique
    await queryRunner.dropUniqueConstraint('client_agent_credentials', 'uq_client_agent');
    // Drop table
    await queryRunner.dropTable('client_agent_credentials');
  }
}
