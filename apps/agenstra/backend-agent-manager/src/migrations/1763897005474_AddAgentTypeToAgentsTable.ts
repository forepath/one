import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add agent_type column to agents table.
 * This migration adds support for multiple agent provider types (e.g., cursor, openai, anthropic).
 * Existing agents will default to 'cursor' type for backward compatibility.
 */
export class AddAgentTypeToAgentsTable1763897005474 implements MigrationInterface {
  name = 'AddAgentTypeToAgentsTable1763897005474';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add agent_type column with default value 'cursor' for backward compatibility
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'agent_type',
        type: 'varchar',
        length: '50',
        default: "'cursor'",
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove agent_type column
    await queryRunner.dropColumn('agents', 'agent_type');
  }
}
