import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Initial migration to create the agents table.
 * This migration creates the agents table with all required columns and constraints
 * based on the AgentEntity definition.
 */
export class CreateAgentsTable1762374977000 implements MigrationInterface {
  name = 'CreateAgentsTable1762374977000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable UUID extension for PostgreSQL (if not already enabled)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Create agents table
    await queryRunner.createTable(
      new Table({
        name: 'agents',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'hashed_password',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'container_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'volume_path',
            type: 'varchar',
            length: '255',
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

    // Create index on name column for faster lookups
    await queryRunner.createIndex(
      'agents',
      new TableIndex({
        name: 'IDX_agents_name',
        columnNames: ['name'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.dropIndex('agents', 'IDX_agents_name');

    // Drop table
    await queryRunner.dropTable('agents');
  }
}
