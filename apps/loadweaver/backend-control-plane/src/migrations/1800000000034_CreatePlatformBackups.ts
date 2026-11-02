import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformBackups1800000000034 implements MigrationInterface {
  name = 'CreatePlatformBackups1800000000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backups of the control plane's own data (3.20): scheduler state per kind, retention delete grants for the
    // S3 gateway, point-in-time restores. The backups themselves are rows in lw_backups (resource platform/<kind>).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_platform_backup_state" (
        "kind" varchar(16) PRIMARY KEY,
        "first_seen_at" TIMESTAMPTZ NOT NULL,
        "last_started_at" TIMESTAMPTZ,
        "last_finished_at" TIMESTAMPTZ,
        "last_status" varchar(16),
        "last_error" text,
        "last_backup" varchar(128),
        "running_until" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_platform_backup_grants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "role" varchar(16) NOT NULL,
        "prefix" varchar(512) NOT NULL,
        "reason" varchar(64) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_platform_restores" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "kind" varchar(16) NOT NULL,
        "state" varchar(16) NOT NULL,
        "node" varchar(63) NOT NULL,
        "scope" varchar(63) NOT NULL,
        "source_scope" varchar(63) NOT NULL,
        "target_time" TIMESTAMPTZ,
        "error" text,
        "requested_by" varchar(255) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "ready_at" TIMESTAMPTZ,
        "finished_at" TIMESTAMPTZ
      )
    `);
    // At most one active point-in-time restore at a time.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_platform_restores_active" ON "lw_platform_restores" ("kind")
      WHERE "state" IN ('requested', 'restoring', 'ready')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_platform_restores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_platform_backup_grants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_platform_backup_state"`);
  }
}
