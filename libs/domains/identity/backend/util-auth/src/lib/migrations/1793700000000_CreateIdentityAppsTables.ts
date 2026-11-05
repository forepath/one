import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Apps (admin-managed third-party integrations), user grants, app sessions (rotating refresh tokens)
 * and single-use authorization codes. Secrets/tokens are stored as hashes only.
 */
export class CreateIdentityAppsTables1793700000000 implements MigrationInterface {
  name = 'CreateIdentityAppsTables1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "identity_apps" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" varchar(64) NOT NULL DEFAULT 'default',
        "name" varchar(255) NOT NULL,
        "description" varchar(2000),
        "return_url" varchar(2048) NOT NULL,
        "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "secret_prefix" varchar(32) NOT NULL,
        "secret_hash" varchar(255) NOT NULL,
        "secret_rotated_at" timestamp,
        "created_by_user_id" uuid,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_identity_apps" PRIMARY KEY ("id"),
        CONSTRAINT "FK_identity_apps_created_by_user_id" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`COMMENT ON COLUMN "identity_apps"."secret_hash" IS 'bcrypt hash of the app secret'`);
    await queryRunner.query(`CREATE INDEX "IDX_identity_apps_tenant_id" ON "identity_apps" ("tenant_id")`);

    await queryRunner.query(`
      CREATE TABLE "identity_app_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "app_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "tenant_id" varchar(64) NOT NULL DEFAULT 'default',
        "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "last_used_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_identity_app_grants" PRIMARY KEY ("id"),
        CONSTRAINT "FK_identity_app_grants_app_id" FOREIGN KEY ("app_id")
          REFERENCES "identity_apps"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_identity_app_grants_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_identity_app_grants_app_user" ON "identity_app_grants" ("app_id", "user_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_identity_app_grants_user_id" ON "identity_app_grants" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "identity_app_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "grant_id" uuid NOT NULL,
        "app_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "refresh_token_hash" varchar(64) NOT NULL,
        "previous_refresh_token_hash" varchar(64),
        "last_used_at" timestamp,
        "refreshed_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_identity_app_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_identity_app_sessions_grant_id" FOREIGN KEY ("grant_id")
          REFERENCES "identity_app_grants"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `COMMENT ON COLUMN "identity_app_sessions"."refresh_token_hash" IS 'SHA-256 hex of the refresh token'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_identity_app_sessions_refresh_token_hash" ON "identity_app_sessions" ("refresh_token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_identity_app_sessions_previous_refresh_token_hash" ON "identity_app_sessions" ("previous_refresh_token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_identity_app_sessions_grant_id" ON "identity_app_sessions" ("grant_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "identity_app_authorization_codes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code_hash" varchar(64) NOT NULL,
        "grant_id" uuid NOT NULL,
        "app_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "code_challenge" varchar(128),
        "expires_at" timestamp NOT NULL,
        "consumed_at" timestamp,
        "session_id" uuid,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_identity_app_authorization_codes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_identity_app_authorization_codes_grant_id" FOREIGN KEY ("grant_id")
          REFERENCES "identity_app_grants"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_identity_app_authorization_codes_code_hash" ON "identity_app_authorization_codes" ("code_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_identity_app_authorization_codes_grant_id" ON "identity_app_authorization_codes" ("grant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "identity_app_authorization_codes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "identity_app_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "identity_app_grants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "identity_apps"`);
  }
}
