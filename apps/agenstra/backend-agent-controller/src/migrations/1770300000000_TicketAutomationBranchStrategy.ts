import { MigrationInterface, QueryRunner } from 'typeorm';

export class TicketAutomationBranchStrategy1770300000000 implements MigrationInterface {
  name = 'TicketAutomationBranchStrategy1770300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ticket_automation"
      ADD COLUMN IF NOT EXISTS "automation_branch_strategy" character varying(32) NOT NULL DEFAULT 'reuse_per_ticket'
    `);
    await queryRunner.query(`
      ALTER TABLE "ticket_automation"
      ADD COLUMN IF NOT EXISTS "force_new_automation_branch_next_run" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ticket_automation" DROP COLUMN IF EXISTS "force_new_automation_branch_next_run"
    `);
    await queryRunner.query(`
      ALTER TABLE "ticket_automation" DROP COLUMN IF EXISTS "automation_branch_strategy"
    `);
  }
}
