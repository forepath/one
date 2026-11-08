import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Atlassian connections (`/connections/atlassian`) gain a second auth variant and a persisted test status.
 *
 * - `auth_type`: `token` (email + API token, HTTP Basic against the site URL; every existing row) or `app`
 *   (OAuth 2.0 client credentials of an Atlassian service account against `api.atlassian.com`). New rows default to
 *   `app` in the service; the column default stays `token` so existing rows keep working unchanged.
 * - `account_email` / `api_token` become nullable (unused for `app`).
 * - `oauth_client_id`, `oauth_client_secret` (AES-256-GCM ciphertext written by the entity transformer), `cloud_id`
 *   (cached from `{site}/_edge/tenant_info`).
 * - `last_test_status` (`untested` | `ok` | `failed`), `last_test_message`, `last_tested_at`.
 */
export class AddAtlassianConnectionAuthVariants1794400000000 implements MigrationInterface {
  name = 'AddAtlassianConnectionAuthVariants1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "atlassian_site_connections" ADD COLUMN "auth_type" varchar(16) NOT NULL DEFAULT 'token'`,
    );
    await queryRunner.query(
      `ALTER TABLE "atlassian_site_connections" ADD CONSTRAINT "CHK_atlassian_site_connections_auth_type" CHECK ("auth_type" IN ('app', 'token'))`,
    );
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" ALTER COLUMN "account_email" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" ALTER COLUMN "api_token" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" ADD COLUMN "oauth_client_id" varchar(255) NULL`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" ADD COLUMN "oauth_client_secret" text NULL`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" ADD COLUMN "cloud_id" varchar(64) NULL`);
    await queryRunner.query(
      `ALTER TABLE "atlassian_site_connections" ADD COLUMN "last_test_status" varchar(16) NOT NULL DEFAULT 'untested'`,
    );
    await queryRunner.query(
      `ALTER TABLE "atlassian_site_connections" ADD CONSTRAINT "CHK_atlassian_site_connections_last_test_status" CHECK ("last_test_status" IN ('untested', 'ok', 'failed'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "atlassian_site_connections" ADD COLUMN "last_test_message" varchar(512) NULL`,
    );
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" ADD COLUMN "last_tested_at" timestamptz NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `app` connections have no email/token; they cannot survive the NOT NULL constraints of the old schema.
    await queryRunner.query(`DELETE FROM "atlassian_site_connections" WHERE "auth_type" = 'app'`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" DROP COLUMN "last_tested_at"`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" DROP COLUMN "last_test_message"`);
    await queryRunner.query(
      `ALTER TABLE "atlassian_site_connections" DROP CONSTRAINT "CHK_atlassian_site_connections_last_test_status"`,
    );
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" DROP COLUMN "last_test_status"`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" DROP COLUMN "cloud_id"`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" DROP COLUMN "oauth_client_secret"`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" DROP COLUMN "oauth_client_id"`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" ALTER COLUMN "api_token" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" ALTER COLUMN "account_email" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "atlassian_site_connections" DROP CONSTRAINT "CHK_atlassian_site_connections_auth_type"`,
    );
    await queryRunner.query(`ALTER TABLE "atlassian_site_connections" DROP COLUMN "auth_type"`);
  }
}
