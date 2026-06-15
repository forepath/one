import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to add 'updated' to statistics_entity_event_type_enum.
 * Allows entity events to record updates in addition to created/deleted.
 */
export class AddUpdatedToEntityEventType1766200000000 implements MigrationInterface {
  name = 'AddUpdatedToEntityEventType1766200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "statistics_entity_event_type_enum" ADD VALUE IF NOT EXISTS 'updated';
    `);
  }

  public async down(_: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values directly.
    // Reverting would require recreating the type and column, which is complex.
    // Leaving the migration as additive only.
    throw new Error('Cannot remove enum value; migration is additive only');
  }
}
