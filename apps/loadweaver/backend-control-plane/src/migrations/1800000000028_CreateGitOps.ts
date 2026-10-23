import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGitOps1800000000028 implements MigrationInterface {
  name = 'CreateGitOps1800000000028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Where a plan came from (3.29): Git (connection, commit, ref, author), the UI, the API, drift or the system.
    await queryRunner.query(`ALTER TABLE "lw_plans" ADD COLUMN IF NOT EXISTS "source" jsonb`);
    // One repository per scope (cluster or project), managed directly.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_git_connections" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "project" varchar(63),
        "scope_key" varchar(63) NOT NULL,
        "provider" varchar(16) NOT NULL,
        "repo_url" text NOT NULL,
        "branch" varchar(255) NOT NULL,
        "path" varchar(512) NOT NULL DEFAULT '',
        "mode" varchar(16) NOT NULL,
        "credentials" varchar(300),
        "api_url" text,
        "ca_certificate" text,
        "poll_interval_seconds" integer,
        "webhook" boolean NOT NULL DEFAULT true,
        "approval_by_merge_review" boolean NOT NULL DEFAULT false,
        "memberships_from_git" boolean NOT NULL DEFAULT false,
        "auto_merge" boolean NOT NULL DEFAULT true,
        "sops" boolean NOT NULL DEFAULT false,
        "host_key" text,
        "last_synced_commit" varchar(64),
        "last_sync_at" TIMESTAMPTZ,
        "last_poll_at" TIMESTAMPTZ,
        "sync_requested" boolean NOT NULL DEFAULT false,
        "last_error" text,
        "created_by" varchar(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_lw_git_connections_scope_key" CHECK ("scope_key" = COALESCE("project", ''))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_git_connections_scope" ON "lw_git_connections" ("scope_key")`,
    );
    // Commits Loadweaver synced or wrote, the plan they created and the status reported for them.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_git_commits" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "connection_id" uuid NOT NULL REFERENCES "lw_git_connections" ("id") ON DELETE CASCADE,
        "sha" varchar(64) NOT NULL,
        "ref" varchar(255) NOT NULL,
        "kind" varchar(16) NOT NULL,
        "plan_id" uuid,
        "author" varchar(255),
        "message" varchar(200),
        "state" varchar(16) NOT NULL,
        "reported_state" varchar(16),
        "reason" text,
        "paths" jsonb NOT NULL DEFAULT '{}',
        "pr_url" text,
        "pr_number" integer,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_git_commits_connection" ON "lw_git_commits" ("connection_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_git_commits_plan" ON "lw_git_commits" ("plan_id")`);
    // Per connection and resource: its file and the generation that matched Git (conflicts, write-back).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_git_resource_state" (
        "connection_id" uuid NOT NULL REFERENCES "lw_git_connections" ("id") ON DELETE CASCADE,
        "kind" varchar(64) NOT NULL,
        "project_key" varchar(63) NOT NULL,
        "name" varchar(63) NOT NULL,
        "path" varchar(1024) NOT NULL,
        "generation" integer NOT NULL,
        "commit" varchar(64) NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_git_resource_state" PRIMARY KEY ("connection_id", "kind", "project_key", "name")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_git_resource_state"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_git_commits"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_git_connections"`);
    await queryRunner.query(`ALTER TABLE "lw_plans" DROP COLUMN IF EXISTS "source"`);
  }
}
