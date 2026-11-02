import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenGitPlanBot1800000000030 implements MigrationInterface {
  name = 'HardenGitPlanBot1800000000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rotatable webhook secrets (random salt in the HKDF info; null = the original derivation) and push-author hints.
    await queryRunner.query(`ALTER TABLE "lw_git_connections" ADD COLUMN IF NOT EXISTS "webhook_salt" varchar(64)`);
    await queryRunner.query(
      `ALTER TABLE "lw_git_connections" ADD COLUMN IF NOT EXISTS "webhook_generation" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "lw_git_connections" ADD COLUMN IF NOT EXISTS "push_authors" jsonb`);
    // Resources read from SOPS files are never written back or exported in clear.
    await queryRunner.query(
      `ALTER TABLE "lw_git_resource_state" ADD COLUMN IF NOT EXISTS "sops" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "lw_git_commits" ADD COLUMN IF NOT EXISTS "sops_keys" jsonb NOT NULL DEFAULT '[]'`,
    );
    // OAuth links wait for the user's confirmation in the console.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_git_pending_links" (
        "nonce" varchar(64) PRIMARY KEY,
        "user_id" varchar(255) NOT NULL,
        "provider" varchar(16) NOT NULL,
        "provider_user_id" varchar(64) NOT NULL,
        "login" varchar(255) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL
      )
    `);
    // Handled webhook deliveries and bot comments (replay protection, bounded retention).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_git_webhook_deliveries" (
        "connection_id" uuid NOT NULL REFERENCES "lw_git_connections" ("id") ON DELETE CASCADE,
        "key" varchar(160) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY ("connection_id", "key")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_git_webhook_deliveries_created" ON "lw_git_webhook_deliveries" ("created_at")`,
    );
    // Leases instead of session advisory locks: no pooled connection is held during clones / pushes.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_git_locks" (
        "key" varchar(64) PRIMARY KEY,
        "owner" varchar(64) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_git_locks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_git_webhook_deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_git_pending_links"`);
    await queryRunner.query(`ALTER TABLE "lw_git_commits" DROP COLUMN IF EXISTS "sops_keys"`);
    await queryRunner.query(`ALTER TABLE "lw_git_resource_state" DROP COLUMN IF EXISTS "sops"`);
    await queryRunner.query(`ALTER TABLE "lw_git_connections" DROP COLUMN IF EXISTS "push_authors"`);
    await queryRunner.query(`ALTER TABLE "lw_git_connections" DROP COLUMN IF EXISTS "webhook_generation"`);
    await queryRunner.query(`ALTER TABLE "lw_git_connections" DROP COLUMN IF EXISTS "webhook_salt"`);
  }
}
