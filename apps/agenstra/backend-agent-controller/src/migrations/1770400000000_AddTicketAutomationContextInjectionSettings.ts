import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTicketAutomationContextInjectionSettings1770400000000 implements MigrationInterface {
  name = 'AddTicketAutomationContextInjectionSettings1770400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ticket_automation"
      ADD COLUMN IF NOT EXISTS "include_workspace_context" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "ticket_automation"
      ADD COLUMN IF NOT EXISTS "context_environment_ids" jsonb NOT NULL DEFAULT '[]'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ticket_automation" DROP COLUMN IF EXISTS "context_environment_ids"
    `);
    await queryRunner.query(`
      ALTER TABLE "ticket_automation" DROP COLUMN IF EXISTS "include_workspace_context"
    `);
  }
}
