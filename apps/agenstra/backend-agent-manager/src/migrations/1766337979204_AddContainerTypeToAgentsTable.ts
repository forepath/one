import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add container_type column to agents table.
 * This migration adds support for multiple container types (e.g., generic, docker, terraform, kubernetes).
 * Existing agents will default to 'generic' type for backward compatibility.
 */
export class AddContainerTypeToAgentsTable1766337979204 implements MigrationInterface {
  name = 'AddContainerTypeToAgentsTable1766337979204';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add container_type column with default value 'generic' for backward compatibility
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'container_type',
        type: 'varchar',
        length: '50',
        default: "'generic'",
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove container_type column
    await queryRunner.dropColumn('agents', 'container_type');
  }
}
