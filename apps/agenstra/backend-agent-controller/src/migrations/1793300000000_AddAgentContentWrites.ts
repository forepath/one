import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Explicit opt-ins for ticket / knowledge changes of unattended runs (`agenstra_content_*` tools), both approved
 * content and empty by default (visible chats ask the user per change instead):
 * - `agent_tasks.allowed_content_writes`: operations the runs of a scheduled task may make
 * - `ticket_automation.allowed_content_writes`: ticket operations autonomous runs may make within the ticket's tree
 */
export class AddAgentContentWrites1793300000000 implements MigrationInterface {
  name = 'AddAgentContentWrites1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_tasks" ADD COLUMN IF NOT EXISTS "allowed_content_writes" JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_automation" ADD COLUMN IF NOT EXISTS "allowed_content_writes" JSONB NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ticket_automation" DROP COLUMN IF EXISTS "allowed_content_writes"`);
    await queryRunner.query(`ALTER TABLE "agent_tasks" DROP COLUMN IF EXISTS "allowed_content_writes"`);
  }
}
