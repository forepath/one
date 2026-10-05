import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameAutomationCompletionSignal1775400000000 implements MigrationInterface {
  name = 'RenameAutomationCompletionSignal1775400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ticket_automation_run"
      RENAME COLUMN "completion_marker_seen" TO "completion_signal_seen"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ticket_automation_run"
      RENAME COLUMN "completion_signal_seen" TO "completion_marker_seen"
    `);
  }
}
