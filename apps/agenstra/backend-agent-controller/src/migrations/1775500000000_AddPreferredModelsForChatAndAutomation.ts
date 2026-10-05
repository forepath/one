import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist explicit OpenCode model (`provider/model`) for ticket chat/AI and automation.
 * OpenCode no longer has an auto model; callers must pass a concrete selection.
 */
export class AddPreferredModelsForChatAndAutomation1775500000000 implements MigrationInterface {
  name = 'AddPreferredModelsForChatAndAutomation1775500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tickets"
      ADD COLUMN IF NOT EXISTS "preferred_chat_model" varchar(256) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "ticket_automation"
      ADD COLUMN IF NOT EXISTS "preferred_model" varchar(256) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ticket_automation" DROP COLUMN IF EXISTS "preferred_model"
    `);
    await queryRunner.query(`
      ALTER TABLE "tickets" DROP COLUMN IF EXISTS "preferred_chat_model"
    `);
  }
}
