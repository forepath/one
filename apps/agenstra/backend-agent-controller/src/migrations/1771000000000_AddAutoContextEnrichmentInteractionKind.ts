import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds auto_context_enrichment interaction kind for auto-enrichment telemetry.
 */
export class AddAutoContextEnrichmentInteractionKind1771000000000 implements MigrationInterface {
  name = 'AddAutoContextEnrichmentInteractionKind1771000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "statistics_interaction_kind_enum" ADD VALUE IF NOT EXISTS 'auto_context_enrichment'
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing enum values safely; keep value.
  }
}
