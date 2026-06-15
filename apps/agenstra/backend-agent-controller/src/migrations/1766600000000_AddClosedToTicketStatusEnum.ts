import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `closed` to ticket_status_enum for terminal tickets hidden from swimlanes but searchable.
 */
export class AddClosedToTicketStatusEnum1766600000000 implements MigrationInterface {
  name = 'AddClosedToTicketStatusEnum1766600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "ticket_status_enum" ADD VALUE IF NOT EXISTS 'closed'
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot remove enum values safely; no-op.
  }
}
