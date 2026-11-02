import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Update rollout (3.26): known releases (announced / imported bundles), update plans with their steps, frozen apt
 * snapshots and the cluster-local apt source's package files; nodes report component versions and carry the target
 * the rollout set. Expand-only: nothing existing changes shape.
 */
export class CreateReleasesAndRollouts1800000000032 implements MigrationInterface {
  name = 'CreateReleasesAndRollouts1800000000032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_releases" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "version" varchar(64) NOT NULL UNIQUE,
        "channel" varchar(8) NOT NULL,
        "status" varchar(16) NOT NULL,
        "source" varchar(16) NOT NULL,
        "manifest_text" text,
        "manifest" jsonb,
        "signature" jsonb,
        "key_id" varchar(16),
        "imported" jsonb,
        "announcement" jsonb,
        "error" text,
        "imported_by" varchar(255),
        "imported_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_releases_status" ON "lw_releases" ("status")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_rollouts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "status" varchar(20) NOT NULL DEFAULT 'planned',
        "from_version" varchar(64),
        "to_version" varchar(64) NOT NULL,
        "kind" varchar(8) NOT NULL,
        "options" jsonb NOT NULL,
        "diff" jsonb NOT NULL DEFAULT '[]',
        "notes" jsonb NOT NULL DEFAULT '[]',
        "warnings" jsonb NOT NULL DEFAULT '[]',
        "failure_analysis" jsonb NOT NULL DEFAULT '[]',
        "created_by" varchar(255),
        "approved_by" varchar(255),
        "approved_at" TIMESTAMPTZ,
        "pause_reason" text,
        "pause_requested" boolean NOT NULL DEFAULT false,
        "lease_owner" varchar(64),
        "lease_until" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ,
        "finished_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_rollouts_created_at" ON "lw_rollouts" ("created_at")`);
    // At most one rollout is active at a time (approved / running / paused / rolling back).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lw_rollouts_one_active" ON "lw_rollouts" ((true)) WHERE "status" IN ('approved', 'running', 'paused', 'rolling-back')`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_rollout_steps" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "rollout_id" uuid NOT NULL REFERENCES "lw_rollouts" ("id") ON DELETE CASCADE,
        "index" integer NOT NULL,
        "wave" integer NOT NULL,
        "phase" varchar(16) NOT NULL,
        "node" varchar(63) NOT NULL,
        "site" varchar(63) NOT NULL,
        "kind" varchar(16) NOT NULL,
        "state" varchar(20) NOT NULL DEFAULT 'pending',
        "before" jsonb,
        "target" jsonb NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}',
        "error" text,
        "state_changed_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ,
        "finished_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lw_rollout_steps_rollout" ON "lw_rollout_steps" ("rollout_id", "index")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_apt_snapshots" (
        "id" varchar(63) PRIMARY KEY,
        "sources" jsonb NOT NULL,
        "files" jsonb NOT NULL,
        "origin" varchar(16) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_apt_files" (
        "source_url" varchar(300) NOT NULL,
        "path" varchar(400) NOT NULL,
        "sha256" varchar(64) NOT NULL,
        "size" bigint NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY ("source_url", "path")
      )
    `);
    // `agent_version` exists since the first nodes table; versions of everything else and the rollout's target are new.
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "agent_version" varchar(64)`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "component_versions" jsonb`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "component_target" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "component_target"`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "component_versions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_apt_files"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_apt_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_rollout_steps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_rollouts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_releases"`);
  }
}
