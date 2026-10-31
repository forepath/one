import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformDisasterRecovery1800000000037 implements MigrationInterface {
  name = 'PlatformDisasterRecovery1800000000037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // External (encrypted) copies of the platform bucket per target and object (3.20).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_platform_copies" (
        "target" varchar(63) NOT NULL,
        "key" varchar(1024) NOT NULL,
        "etag" varchar(128) NOT NULL,
        "size" bigint NOT NULL,
        "stored_size" bigint NOT NULL,
        "generation" integer NOT NULL,
        "copied_at" TIMESTAMPTZ NOT NULL,
        "locked_until" TIMESTAMPTZ,
        PRIMARY KEY ("target", "key")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_platform_copy_targets" (
        "target" varchar(63) PRIMARY KEY,
        "last_started_at" TIMESTAMPTZ,
        "last_finished_at" TIMESTAMPTZ,
        "last_status" varchar(16),
        "last_error" text,
        "objects" integer NOT NULL DEFAULT 0,
        "bytes" bigint NOT NULL DEFAULT 0,
        "verified_envelope" varchar(160),
        "verified_at" TIMESTAMPTZ
      )
    `);
    // Cut-over to a point-in-time clone. The control plane also creates this table in the clone's database before
    // the switch (IF NOT EXISTS, identical definition), so a clone of a time before this migration works too.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_platform_cutovers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "restore_id" uuid NOT NULL,
        "state" varchar(16) NOT NULL,
        "node" varchar(63) NOT NULL,
        "scope" varchar(63) NOT NULL,
        "previous_scope" varchar(63) NOT NULL,
        "target_time" TIMESTAMPTZ,
        "plan" jsonb NOT NULL,
        "requested_by" varchar(255) NOT NULL,
        "approved_by" varchar(255),
        "approved_at" TIMESTAMPTZ,
        "final_backup" varchar(128),
        "error" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "switched_at" TIMESTAMPTZ,
        "finished_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_platform_cutovers_active" ON "lw_platform_cutovers" ((true))
      WHERE "state" IN ('planned', 'approved', 'switching')
    `);
    // Whole-cluster disaster recovery runs (one per bootstrap --restore).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_dr_recoveries" (
        "id" uuid PRIMARY KEY,
        "node" varchar(63) NOT NULL,
        "state" varchar(16) NOT NULL,
        "previous_nodes" jsonb NOT NULL DEFAULT '[]',
        "reseed" jsonb NOT NULL DEFAULT '{}',
        "volumes" jsonb NOT NULL DEFAULT '{}',
        "restore_volumes" boolean NOT NULL DEFAULT true,
        "error" text,
        "started_at" TIMESTAMPTZ NOT NULL,
        "key_restored_at" TIMESTAMPTZ,
        "replanned_at" TIMESTAMPTZ,
        "completed_at" TIMESTAMPTZ
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_dr_recoveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_platform_cutovers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_platform_copy_targets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_platform_copies"`);
  }
}
