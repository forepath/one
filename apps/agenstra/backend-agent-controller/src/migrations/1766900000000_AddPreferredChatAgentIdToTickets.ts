import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists which workspace agent the user prefers for chat/AI when viewing this ticket.
 */
export class AddPreferredChatAgentIdToTickets1766900000000 implements MigrationInterface {
  name = 'AddPreferredChatAgentIdToTickets1766900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tickets"
      ADD COLUMN IF NOT EXISTS "preferred_chat_agent_id" uuid NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tickets" DROP COLUMN IF EXISTS "preferred_chat_agent_id"
    `);
  }
}
