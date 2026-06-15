import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Migration to create deployment_runs table.
 * This table stores pipeline/workflow run history and status for tracking deployments.
 */
export class CreateDeploymentRunsTable1766995500000 implements MigrationInterface {
  name = 'CreateDeploymentRunsTable1766995500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'deployment_runs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'configuration_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'provider_run_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'run_name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'conclusion',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'ref',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'sha',
            type: 'varchar',
            length: '40',
            isNullable: false,
          },
          {
            name: 'workflow_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'workflow_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'started_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'completed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'html_url',
            type: 'text',
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

    // Create foreign key to deployment_configurations table
    await queryRunner.createForeignKey(
      'deployment_runs',
      new TableForeignKey({
        columnNames: ['configuration_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'deployment_configurations',
        onDelete: 'CASCADE',
      }),
    );

    // Create index on configuration_id for efficient lookups
    await queryRunner.createIndex(
      'deployment_runs',
      new TableIndex({
        name: 'idx_deployment_runs_configuration_id',
        columnNames: ['configuration_id'],
      }),
    );

    // Create index on provider_run_id for provider-specific lookups
    await queryRunner.createIndex(
      'deployment_runs',
      new TableIndex({
        name: 'idx_deployment_runs_provider_run_id',
        columnNames: ['provider_run_id'],
      }),
    );

    // Create index on status for filtering
    await queryRunner.createIndex(
      'deployment_runs',
      new TableIndex({
        name: 'idx_deployment_runs_status',
        columnNames: ['status'],
      }),
    );

    // Create index on created_at for chronological sorting
    await queryRunner.createIndex(
      'deployment_runs',
      new TableIndex({
        name: 'idx_deployment_runs_created_at',
        columnNames: ['created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('deployment_runs');
  }
}
