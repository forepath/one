import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSecretTables1800000000002 implements MigrationInterface {
  name = 'CreateSecretTables1800000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "seal_public_key" varchar(64)`);
    await queryRunner.query(
      `ALTER TABLE "lw_plans" ADD COLUMN IF NOT EXISTS "deployment_states" jsonb NOT NULL DEFAULT '{}'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_master_keys" (
        "id" varchar(16) NOT NULL,
        "threshold" integer NOT NULL,
        "holders" jsonb NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "retired_at" TIMESTAMPTZ,
        CONSTRAINT "PK_lw_master_keys" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lw_master_keys_active" ON "lw_master_keys" ("active") WHERE "active"`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_secrets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "project" varchar(63) NOT NULL,
        "name" varchar(128) NOT NULL,
        "version" integer NOT NULL,
        "key_id" varchar(16) NOT NULL,
        "wrapped_key" bytea NOT NULL,
        "ciphertext" bytea NOT NULL,
        "fingerprint" varchar(64) NOT NULL,
        "created_by" varchar(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_secrets" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lw_secrets_identity" ON "lw_secrets" ("project", "name", "version")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_unseal_requests" (
        "id" uuid NOT NULL,
        "key_id" varchar(16) NOT NULL,
        "requester_public_key" varchar(64) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_unseal_requests" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_unseal_shares" (
        "request_id" uuid NOT NULL,
        "node" varchar(63) NOT NULL,
        "sealed_share" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_unseal_shares" PRIMARY KEY ("request_id", "node"),
        CONSTRAINT "FK_lw_unseal_shares_request" FOREIGN KEY ("request_id") REFERENCES "lw_unseal_requests" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_deployment_states" (
        "id" varchar(128) NOT NULL,
        "images" jsonb NOT NULL DEFAULT '{}',
        "secret_versions" jsonb NOT NULL DEFAULT '{}',
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_deployment_states" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_deployment_states"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_unseal_shares"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_unseal_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_secrets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_master_keys"`);
    await queryRunner.query(`ALTER TABLE "lw_plans" DROP COLUMN IF EXISTS "deployment_states"`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "seal_public_key"`);
  }
}
