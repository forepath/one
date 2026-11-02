import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBackups1800000000033 implements MigrationInterface {
  name = 'CreateBackups1800000000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backup key hierarchy (3.20): root key per generation, wrapped by the master key, recovery kit, KMS escrow.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_backup_keys" (
        "generation" integer PRIMARY KEY,
        "root_id" varchar(16) NOT NULL,
        "key_id" varchar(16) NOT NULL,
        "wrapped_key" bytea NOT NULL,
        "ciphertext" bytea NOT NULL,
        "active" boolean NOT NULL DEFAULT false,
        "kit_shares" integer NOT NULL,
        "kit_threshold" integer NOT NULL,
        "kit" jsonb NOT NULL DEFAULT '[]',
        "kit_confirmed_at" TIMESTAMPTZ,
        "kit_confirmed_by" varchar(255),
        "escrow" jsonb,
        "retired_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_backup_keys_active" ON "lw_backup_keys" ("active") WHERE "active"`,
    );
    // Catalog: one row per snapshot (kept after deletion for the timeline).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_backups" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "scope" varchar(128) NOT NULL,
        "project" varchar(128),
        "resource" varchar(512) NOT NULL,
        "policy" varchar(255),
        "node" varchar(128),
        "status" varchar(32) NOT NULL,
        "snapshot_id" varchar(128),
        "root_object" varchar(160),
        "key_generation" integer NOT NULL,
        "bytes" bigint NOT NULL DEFAULT 0,
        "uploaded_bytes" bigint NOT NULL DEFAULT 0,
        "files" integer NOT NULL DEFAULT 0,
        "targets" jsonb NOT NULL DEFAULT '[]',
        "keep" jsonb NOT NULL DEFAULT '[]',
        "hooks" boolean NOT NULL DEFAULT false,
        "command" jsonb,
        "error" text,
        "started_at" TIMESTAMPTZ NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "deleted_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_backups_resource" ON "lw_backups" ("scope", "resource", "started_at")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_backups_project" ON "lw_backups" ("project")`);
    // Deletions and retention shortening: second admin + delay.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_backup_deletions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "kind" varchar(16) NOT NULL,
        "scope" varchar(128) NOT NULL,
        "backup_ids" jsonb NOT NULL DEFAULT '[]',
        "retention" jsonb,
        "reason" text NOT NULL,
        "state" varchar(16) NOT NULL,
        "requested_by" varchar(255) NOT NULL,
        "approved_by" varchar(255),
        "approved_at" TIMESTAMPTZ,
        "not_before" TIMESTAMPTZ NOT NULL,
        "executed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_restore_tests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "backup_id" uuid NOT NULL,
        "scope" varchar(128) NOT NULL,
        "project" varchar(128),
        "resource" varchar(512) NOT NULL,
        "node" varchar(128),
        "status" varchar(16) NOT NULL,
        "key_generation" integer NOT NULL,
        "check" jsonb,
        "command" jsonb,
        "error" text,
        "started_at" TIMESTAMPTZ NOT NULL,
        "finished_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_restore_tests_resource" ON "lw_restore_tests" ("resource", "started_at")`,
    );
    // Repositories (one per trust boundary) and their servers on the members.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_backup_repositories" (
        "scope" varchar(80) PRIMARY KEY,
        "port" integer NOT NULL UNIQUE,
        "key_generation" integer NOT NULL,
        "certificate" text NOT NULL,
        "private_key" text NOT NULL,
        "fingerprint" varchar(64) NOT NULL,
        "users" jsonb NOT NULL DEFAULT '[]',
        "ready_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Restores (resources executed once per generation).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_restores" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project" varchar(128) NOT NULL,
        "name" varchar(128) NOT NULL,
        "generation" integer NOT NULL,
        "backup_id" uuid NOT NULL,
        "volume" varchar(512) NOT NULL,
        "kind" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL,
        "node" varchar(128),
        "progress" jsonb,
        "command" jsonb,
        "error" text,
        "started_at" TIMESTAMPTZ,
        "finished_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_restores_resource" ON "lw_restores" ("project", "name", "generation")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_backup_retention" (
        "policy" varchar(300) PRIMARY KEY,
        "effective" jsonb NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_backup_retention"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_restores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_backup_repositories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_restore_tests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_backup_deletions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_backups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_backup_keys"`);
  }
}
