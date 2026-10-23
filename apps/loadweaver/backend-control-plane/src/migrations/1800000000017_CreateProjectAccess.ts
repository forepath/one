import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectAccess1800000000017 implements MigrationInterface {
  name = 'CreateProjectAccess1800000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_project_members" (
        "project" varchar(63) NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "role" varchar(16) NOT NULL,
        "created_by" varchar(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_project_members" PRIMARY KEY ("project", "user_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_project_members_user" ON "lw_project_members" ("user_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_project_settings" (
        "project" varchar(63) PRIMARY KEY,
        "approval_mode" varchar(16) NOT NULL DEFAULT 'developers',
        "developer_exec" boolean NOT NULL DEFAULT false,
        "created_by" varchar(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_plan_approvals" (
        "plan_id" uuid NOT NULL,
        "project" varchar(63) NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "via" varchar(16) NOT NULL DEFAULT 'member',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_plan_approvals" PRIMARY KEY ("plan_id", "project", "user_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_policy_acceptances" (
        "project" varchar(63) NOT NULL,
        "policy" varchar(63) NOT NULL,
        "peer" varchar(63) NOT NULL,
        "spec_hash" varchar(64) NOT NULL,
        "accepted_by" varchar(255) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_policy_acceptances" PRIMARY KEY ("project", "policy", "peer")
      )
    `);
    // The creator's role per touched project at plan time, and why a project's part is risky (pins, internet).
    await queryRunner.query(
      `ALTER TABLE "lw_plans" ADD COLUMN IF NOT EXISTS "creator_roles" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(`ALTER TABLE "lw_plans" ADD COLUMN IF NOT EXISTS "risk" jsonb NOT NULL DEFAULT '{}'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_plans" DROP COLUMN IF EXISTS "risk"`);
    await queryRunner.query(`ALTER TABLE "lw_plans" DROP COLUMN IF EXISTS "creator_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_policy_acceptances"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_plan_approvals"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_project_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_project_members"`);
  }
}
