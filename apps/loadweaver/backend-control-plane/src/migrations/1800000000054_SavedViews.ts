import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Saved views (3.37): per-user, server-side list views / filters and console settings (density), keyed by owner
 * (user id, `api-key` or the verified fleet person `fleet:<iss>:<sub>`), scope (list id) and name.
 */
export class SavedViews1800000000054 implements MigrationInterface {
  name = 'SavedViews1800000000054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_saved_views" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner" varchar(255) NOT NULL,
        "scope" varchar(100) NOT NULL,
        "name" varchar(100) NOT NULL,
        "state" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_saved_views" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lw_saved_views_owner_scope_name" UNIQUE ("owner", "scope", "name")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_saved_views_owner_scope" ON "lw_saved_views" ("owner", "scope")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_saved_views"`);
  }
}
