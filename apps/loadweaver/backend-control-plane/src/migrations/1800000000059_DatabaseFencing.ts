import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fenced takeover of the cluster's database (3.43, user decision 2026-10-31): the built-in control plane promotes its
 * external copy when no member's Postgres has been primary for a while.
 *
 * - `epoch`: grows with every takeover and every handover; member data of an older epoch is fenced (never primary).
 * - `taken_over_at`: when the external copy last became the database by a takeover (the export cut-off of fenced
 *   members' rows).
 * - `postgres_scope`: the Patroni scope members start empty in after a takeover (the old scope's etcd keys belong to
 *   the fenced data).
 * - `fences`: what fenced members reported (moved-aside data, exported rows), the newest 20.
 */
export class DatabaseFencing1800000000059 implements MigrationInterface {
  name = 'DatabaseFencing1800000000059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_database_handover"
      ADD COLUMN IF NOT EXISTS "epoch" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "taken_over_at" timestamptz,
      ADD COLUMN IF NOT EXISTS "postgres_scope" varchar(63),
      ADD COLUMN IF NOT EXISTS "fences" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_database_handover"
      DROP COLUMN IF EXISTS "fences",
      DROP COLUMN IF EXISTS "postgres_scope",
      DROP COLUMN IF EXISTS "taken_over_at",
      DROP COLUMN IF EXISTS "epoch"`);
  }
}
