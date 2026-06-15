import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds ticket_body_generation to statistics_interaction_kind_enum for agent I/O metrics.
 */
export class AddTicketBodyGenerationToStatisticsInteractionKind1766500000000 implements MigrationInterface {
  name = 'AddTicketBodyGenerationToStatisticsInteractionKind1766500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "statistics_interaction_kind_enum" ADD VALUE IF NOT EXISTS 'ticket_body_generation'
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot remove enum values safely; no-op.
  }
}
