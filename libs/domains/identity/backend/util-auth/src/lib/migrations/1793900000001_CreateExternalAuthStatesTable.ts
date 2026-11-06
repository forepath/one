import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Short-lived, single-use state for external (SAML) sign-in: outstanding AuthnRequest ids, relay states,
 * replay-protection entries for received assertions and one-time login codes. Keys are stored as SHA-256 hashes.
 */
export class CreateExternalAuthStatesTable1793900000001 implements MigrationInterface {
  name = 'CreateExternalAuthStatesTable1793900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "identity_external_auth_states" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kind" varchar(32) NOT NULL,
        "key_hash" varchar(64) NOT NULL,
        "tenant_id" varchar(64) NOT NULL DEFAULT 'default',
        "user_id" uuid,
        "request_id" varchar(256),
        "code_challenge" varchar(128),
        "redirect_path" varchar(2048),
        "value" varchar(256),
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_identity_external_auth_states" PRIMARY KEY ("id"),
        CONSTRAINT "FK_identity_external_auth_states_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_identity_external_auth_states_kind_key_hash"
      ON "identity_external_auth_states" ("kind", "key_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_identity_external_auth_states_expires_at" ON "identity_external_auth_states" ("expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "identity_external_auth_states"`);
  }
}
