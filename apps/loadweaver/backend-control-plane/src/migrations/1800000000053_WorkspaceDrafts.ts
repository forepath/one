import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Workspace drafts (3.36): server-side, shared drafts of resource changes (ops with base generations, optimistic
 * version) that are submitted as ordinary plans.
 */
export class WorkspaceDrafts1800000000053 implements MigrationInterface {
  name = 'WorkspaceDrafts1800000000053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_drafts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" varchar(200) NOT NULL,
        "owner" varchar(255) NOT NULL,
        "projects" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "cluster_scope" varchar(16),
        "ops" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "version" integer NOT NULL DEFAULT 1,
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "plan_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_drafts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lw_drafts_status" CHECK ("status" IN ('open', 'submitted', 'discarded'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_drafts_status_updated" ON "lw_drafts" ("status", "updated_at")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_drafts_owner" ON "lw_drafts" ("owner")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_drafts"`);
  }
}
