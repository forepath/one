import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Migration to create deployment_configurations table.
 * This table stores CI/CD provider configuration for agents, including encrypted credentials.
 */
export class CreateDeploymentConfigurationsTable1766995400000 implements MigrationInterface {
  name = 'CreateDeploymentConfigurationsTable1766995400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'deployment_configurations',
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
            name: 'provider_type',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'repository_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'default_branch',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'workflow_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'provider_token',
            type: 'varchar',
            length: '2048',
            isNullable: false,
            comment: 'Encrypted provider API token',
          },
          {
            name: 'provider_base_url',
            type: 'varchar',
            length: '512',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create foreign key to agents table
    await queryRunner.createForeignKey(
      'deployment_configurations',
      new TableForeignKey({
        columnNames: ['agent_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'agents',
        onDelete: 'CASCADE',
      }),
    );

    // Create unique index on agent_id (one configuration per agent)
    await queryRunner.createIndex(
      'deployment_configurations',
      new TableIndex({
        name: 'idx_deployment_configurations_agent_id',
        columnNames: ['agent_id'],
        isUnique: true,
      }),
    );

    // Create index on provider_type for filtering
    await queryRunner.createIndex(
      'deployment_configurations',
      new TableIndex({
        name: 'idx_deployment_configurations_provider_type',
        columnNames: ['provider_type'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('deployment_configurations');
  }
}
