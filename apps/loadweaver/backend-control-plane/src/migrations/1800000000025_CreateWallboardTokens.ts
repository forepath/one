import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWallboardTokens1800000000025 implements MigrationInterface {
  name = 'CreateWallboardTokens1800000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Read-only tokens that can only open the kiosk view (3.25); stored as SHA-256, shown once.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_wallboard_tokens" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" varchar(255) NOT NULL,
        "token_hash" varchar(64) NOT NULL UNIQUE,
        "projects" jsonb,
        "created_by" varchar(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMPTZ,
        "last_used_at" TIMESTAMPTZ,
        "revoked_at" TIMESTAMPTZ
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_wallboard_tokens"`);
  }
}
