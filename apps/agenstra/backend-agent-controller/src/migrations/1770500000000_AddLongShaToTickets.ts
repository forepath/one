import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists a stable long SHA reference per ticket (sha1 of ticket id).
 */
export class AddLongShaToTickets1770500000000 implements MigrationInterface {
  name = 'AddLongShaToTickets1770500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    await queryRunner.query(`
      ALTER TABLE "tickets"
      ADD COLUMN IF NOT EXISTS "long_sha" varchar(40) NULL
    `);

    await queryRunner.query(`
      UPDATE "tickets"
      SET "long_sha" = encode(digest("id"::text, 'sha1'), 'hex')
      WHERE "long_sha" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tickets_long_sha"
      ON "tickets" ("long_sha")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_tickets_long_sha"
    `);

    await queryRunner.query(`
      ALTER TABLE "tickets" DROP COLUMN IF EXISTS "long_sha"
    `);
  }
}
