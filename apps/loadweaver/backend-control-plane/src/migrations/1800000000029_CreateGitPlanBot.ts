import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGitPlanBot1800000000029 implements MigrationInterface {
  name = 'CreateGitPlanBot1800000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // GitHub connections may use the cluster's GitHub App (set by cluster admins only).
    await queryRunner.query(
      `ALTER TABLE "lw_git_connections" ADD COLUMN IF NOT EXISTS "github_app" boolean NOT NULL DEFAULT false`,
    );
    // Git accounts linked to Loadweaver users (3.30): provider user id + login only, never a token.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_git_accounts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" varchar(255) NOT NULL,
        "provider" varchar(16) NOT NULL,
        "provider_user_id" varchar(64) NOT NULL,
        "login" varchar(255) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_git_accounts_provider_user" ON "lw_git_accounts" ("provider", "provider_user_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_git_accounts_user_provider" ON "lw_git_accounts" ("user_id", "provider")`,
    );
    // Pending OAuth links: the nonce of the signed state, deleted on use (single use) or after it expired.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_git_oauth_states" (
        "nonce" varchar(64) PRIMARY KEY,
        "user_id" varchar(255) NOT NULL,
        "provider" varchar(16) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL
      )
    `);
    // Pull / merge requests the plan bot follows: head, current plan (its locks), sticky comment, triggered apply.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_git_pull_requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "connection_id" uuid NOT NULL REFERENCES "lw_git_connections" ("id") ON DELETE CASCADE,
        "number" integer NOT NULL,
        "state" varchar(16) NOT NULL,
        "title" varchar(300) NOT NULL DEFAULT '',
        "url" text,
        "author" varchar(255),
        "head_ref" varchar(255) NOT NULL DEFAULT '',
        "head_sha" varchar(64) NOT NULL DEFAULT '',
        "plan_id" uuid,
        "comment_id" varchar(64),
        "apply_plan_id" uuid,
        "result_posted" boolean NOT NULL DEFAULT true,
        "applied_by" varchar(255),
        "last_error" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_git_pull_requests_number" ON "lw_git_pull_requests" ("connection_id", "number")`,
    );
    // The cluster's age identity for SOPS: public recipient + identity envelope-encrypted with the master key.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_git_sops_keys" (
        "id" varchar(16) PRIMARY KEY,
        "recipient" varchar(128) NOT NULL,
        "key_id" varchar(16) NOT NULL,
        "wrapped_key" bytea NOT NULL,
        "ciphertext" bytea NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_git_sops_keys"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_git_pull_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_git_oauth_states"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_git_accounts"`);
    await queryRunner.query(`ALTER TABLE "lw_git_connections" DROP COLUMN IF EXISTS "github_app"`);
  }
}
