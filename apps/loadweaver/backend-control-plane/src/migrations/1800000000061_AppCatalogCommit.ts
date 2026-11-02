import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * App store (P1, user decision 2026-11-01): the commit a Git catalog's `ref` (branch, tag or commit) resolved to at
 * the last successful refresh, shown in `GET /apps/catalogs` and the console's catalog status. Null for OCI / fleet
 * catalogs and until the next refresh.
 */
export class AppCatalogCommit1800000000061 implements MigrationInterface {
  name = 'AppCatalogCommit1800000000061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_app_catalogs" ADD COLUMN IF NOT EXISTS "resolved_commit" varchar(64)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_app_catalogs" DROP COLUMN IF EXISTS "resolved_commit"`);
  }
}
