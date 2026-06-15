import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Migration to create the agent_messages table.
 * This migration creates the agent_messages table for persisting chat messages
 * bound to agents. Each message has an actor (user or agent) and the message content.
 */
export class CreateAgentMessagesTable1762630302752 implements MigrationInterface {
  name = 'CreateAgentMessagesTable1762630302752';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create agent_messages table
    await queryRunner.createTable(
      new Table({
        name: 'agent_messages',
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
            name: 'actor',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'message',
            type: 'text',
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

    // Create foreign key to agents table
    await queryRunner.createForeignKey(
      'agent_messages',
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
      'agent_messages',
      new TableIndex({
        name: 'IDX_agent_messages_agent_id',
        columnNames: ['agent_id'],
      }),
    );

    // Create index on created_at for chronological ordering
    await queryRunner.createIndex(
      'agent_messages',
      new TableIndex({
        name: 'IDX_agent_messages_created_at',
        columnNames: ['created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex('agent_messages', 'IDX_agent_messages_created_at');
    await queryRunner.dropIndex('agent_messages', 'IDX_agent_messages_agent_id');

    // Drop foreign key
    const table = await queryRunner.getTable('agent_messages');
    const foreignKey = table?.foreignKeys.find((fk) => fk.columnNames.indexOf('agent_id') !== -1);

    if (foreignKey) {
      await queryRunner.dropForeignKey('agent_messages', foreignKey);
    }

    // Drop table
    await queryRunner.dropTable('agent_messages');
  }
}
