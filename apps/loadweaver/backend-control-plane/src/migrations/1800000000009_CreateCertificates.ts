import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCertificates1800000000009 implements MigrationInterface {
  name = 'CreateCertificates1800000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_certificates" (
        "id" varchar(64) PRIMARY KEY,
        "names" jsonb NOT NULL,
        "source" varchar(16) NOT NULL,
        "certificate_pem" text,
        "private_key" text,
        "not_after" TIMESTAMPTZ,
        "failures" integer NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ,
        "last_error" varchar(1000),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_acme_accounts" (
        "directory" varchar(512) PRIMARY KEY,
        "account_url" varchar(1024) NOT NULL,
        "private_key" text NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_acme_challenges" (
        "token" varchar(128) PRIMARY KEY,
        "key_authorization" varchar(256) NOT NULL,
        "name" varchar(253) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_acme_challenges"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_acme_accounts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_certificates"`);
  }
}
