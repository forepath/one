import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The fleet's app catalog (P1 app store, 2026-10-31): the catalog signing key (private key sealed with
 * `ENCRYPTION_KEY`, at most one `active`), uploaded package versions (archive in `bytea`, ≤ 8 MiB), takedowns and
 * the current signed index; plus the "apply catalog settings" operation kind.
 */
export class FleetCatalog1810000000002 implements MigrationInterface {
  name = 'FleetCatalog1810000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_catalog_keys" (
        "kid" varchar(64) NOT NULL,
        "type" varchar(16) NOT NULL,
        "public_key" text NOT NULL,
        "private_key" text NOT NULL,
        "state" varchar(16) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "retired_at" timestamptz,
        CONSTRAINT "PK_lw_fleet_catalog_keys" PRIMARY KEY ("kid"),
        CONSTRAINT "CHK_lw_fleet_catalog_keys_state" CHECK ("state" IN ('active', 'retired')),
        CONSTRAINT "CHK_lw_fleet_catalog_keys_type" CHECK ("type" IN ('ecdsa-p256', 'ed25519'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_fleet_catalog_keys_active" ON "lw_fleet_catalog_keys" ("state") WHERE "state" = 'active'`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_catalog_packages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "app" varchar(63) NOT NULL,
        "version" varchar(128) NOT NULL,
        "channel" varchar(32) NOT NULL,
        "title" varchar(100) NOT NULL,
        "summary" varchar(500) NOT NULL,
        "manifest_publisher" varchar(100) NOT NULL,
        "license" varchar(200) NOT NULL,
        "digest" varchar(71) NOT NULL,
        "size" integer NOT NULL,
        "archive" bytea NOT NULL,
        "signature" text NOT NULL,
        "signed_by" varchar(64) NOT NULL,
        "status" varchar(16) NOT NULL,
        "findings" jsonb NOT NULL DEFAULT '[]',
        "uploaded_by" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz,
        CONSTRAINT "PK_lw_fleet_catalog_packages" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lw_fleet_catalog_packages_status" CHECK ("status" IN ('draft', 'published', 'unpublished')),
        CONSTRAINT "CHK_lw_fleet_catalog_packages_size" CHECK ("size" > 0 AND "size" <= 8388608)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_fleet_catalog_packages_app_version" ON "lw_fleet_catalog_packages" ("app", "version")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_catalog_takedowns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "app" varchar(63) NOT NULL,
        "versions" jsonb NOT NULL,
        "reason" text NOT NULL,
        "created_by" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_fleet_catalog_takedowns" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_catalog_index" (
        "id" smallint NOT NULL,
        "content" text NOT NULL,
        "signature" text NOT NULL,
        "digest" varchar(71) NOT NULL,
        "signed_by" varchar(64) NOT NULL,
        "generated_at" timestamptz NOT NULL,
        CONSTRAINT "PK_lw_fleet_catalog_index" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lw_fleet_catalog_index_single" CHECK ("id" = 1)
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "lw_fleet_operations" DROP CONSTRAINT IF EXISTS "CHK_lw_fleet_operations_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lw_fleet_operations" ADD CONSTRAINT "CHK_lw_fleet_operations_kind" CHECK ("kind" IN ('cross-cluster-restore', 'clone', 'final-backup', 'catalog-settings'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "lw_fleet_operations" WHERE "kind" = 'catalog-settings'`);
    await queryRunner.query(
      `ALTER TABLE "lw_fleet_operations" DROP CONSTRAINT IF EXISTS "CHK_lw_fleet_operations_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lw_fleet_operations" ADD CONSTRAINT "CHK_lw_fleet_operations_kind" CHECK ("kind" IN ('cross-cluster-restore', 'clone', 'final-backup'))`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_catalog_index"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_catalog_takedowns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_catalog_packages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_catalog_keys"`);
  }
}
