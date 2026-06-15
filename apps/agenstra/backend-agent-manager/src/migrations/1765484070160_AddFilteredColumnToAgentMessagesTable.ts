import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add the filtered column to the agent_messages table.
 * This column flags messages that were filtered by chat filters.
 */
export class AddFilteredColumnToAgentMessagesTable1765484070160 implements MigrationInterface {
  name = 'AddFilteredColumnToAgentMessagesTable1765484070160';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'agent_messages',
      new TableColumn({
        name: 'filtered',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('agent_messages', 'filtered');
  }
}
