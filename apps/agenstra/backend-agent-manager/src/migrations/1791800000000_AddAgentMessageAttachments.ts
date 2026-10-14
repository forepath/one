import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentMessageAttachments1791800000000 implements MigrationInterface {
  name = 'AddAgentMessageAttachments1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "attachments" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "attachments"`);
  }
}
