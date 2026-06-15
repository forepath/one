import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Migration to create the agent_environment_variables table.
 * This migration creates the agent_environment_variables table for persisting environment variables
 * bound to agents. Each variable has a variable name and a content.
 */
export class CreateAgentEnvironmentVariablesTable1766995600000 implements MigrationInterface {
  name = 'CreateAgentEnvironmentVariablesTable1766995600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create agent_environment_variables table
    await queryRunner.createTable(
      new Table({
        name: 'agent_environment_variables',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'agent_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'variable',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'content',
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

    // Create foreign key to agents table
    await queryRunner.createForeignKey(
      'agent_environment_variables',
      new TableForeignKey({
        columnNames: ['agent_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'agents',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      }),
    );

    // Create index on agent_id for faster lookups
    await queryRunner.createIndex(
      'agent_environment_variables',
      new TableIndex({
        name: 'IDX_agent_environment_variables_agent_id',
        columnNames: ['agent_id'],
      }),
    );

    // Create index on created_at for chronological ordering
    await queryRunner.createIndex(
      'agent_environment_variables',
      new TableIndex({
        name: 'IDX_agent_environment_variables_created_at',
        columnNames: ['created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex('agent_environment_variables', 'IDX_agent_environment_variables_created_at');
    await queryRunner.dropIndex('agent_environment_variables', 'IDX_agent_environment_variables_agent_id');

    // Drop foreign key
    const table = await queryRunner.getTable('agent_environment_variables');
    const foreignKey = table?.foreignKeys.find((fk) => fk.columnNames.indexOf('agent_id') !== -1);

    if (foreignKey) {
      await queryRunner.dropForeignKey('agent_environment_variables', foreignKey);
    }

    // Drop table
    await queryRunner.dropTable('agent_environment_variables');
  }
}
