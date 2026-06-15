import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `in_progress` to ticket_status_enum (swimlane between todo and prototype).
 */
export class AddInProgressToTicketStatusEnum1766700000000 implements MigrationInterface {
  name = 'AddInProgressToTicketStatusEnum1766700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "ticket_status_enum" ADD VALUE IF NOT EXISTS 'in_progress'
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot remove enum values safely; no-op.
  }
}
