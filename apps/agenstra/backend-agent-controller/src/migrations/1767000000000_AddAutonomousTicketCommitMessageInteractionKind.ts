import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds autonomous_ticket_commit_message to statistics_interaction_kind_enum for commit-subject AI I/O metrics.
 */
export class AddAutonomousTicketCommitMessageInteractionKind1767000000000 implements MigrationInterface {
  name = 'AddAutonomousTicketCommitMessageInteractionKind1767000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "statistics_interaction_kind_enum" ADD VALUE IF NOT EXISTS 'autonomous_ticket_commit_message'
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing enum values safely; leave enum value in place.
  }
}
