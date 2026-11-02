import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * App store (P1): the verified catalog indexes (one row per configured catalog, bound to the source they were verified
 * for), verified package archives (fetched on demand), takedown flags of installed apps, and the app catalog a trusted
 * fleet hosts (URL + signing keys, registered with the fleet).
 */
export class AppStore1800000000060 implements MigrationInterface {
  name = 'AppStore1800000000060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "lw_app_catalogs" (
      "name" varchar(63) PRIMARY KEY,
      "source_hash" varchar(64) NOT NULL,
      "status" varchar(16) NOT NULL,
      "index" jsonb,
      "index_digest" varchar(80),
      "key_id" varchar(64),
      "error" text,
      "last_attempt_at" timestamptz,
      "last_success_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "lw_app_packages" (
      "catalog" varchar(63) NOT NULL,
      "app" varchar(63) NOT NULL,
      "version" varchar(64) NOT NULL,
      "digest" varchar(80) NOT NULL,
      "archive" bytea NOT NULL,
      "key_id" varchar(64) NOT NULL,
      "fetched_at" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("catalog", "app", "version")
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "lw_app_takedown_flags" (
      "project" varchar(63) NOT NULL,
      "deployment" varchar(63) NOT NULL,
      "catalog" varchar(63) NOT NULL,
      "app" varchar(63) NOT NULL,
      "version" varchar(64) NOT NULL,
      "reason" text NOT NULL,
      "taken_down_at" timestamptz NOT NULL,
      "flagged_at" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("project", "deployment")
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_app_takedown_flags_catalog" ON "lw_app_takedown_flags" ("catalog")`,
    );
    await queryRunner.query(`ALTER TABLE "lw_trusted_fleets" ADD COLUMN IF NOT EXISTS "catalog" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_trusted_fleets" DROP COLUMN IF EXISTS "catalog"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_app_takedown_flags"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_app_packages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_app_catalogs"`);
  }
}
