import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Approvals through the fleet (3.24): the fleet's Ed25519 identity keys (private key sealed with `ENCRYPTION_KEY`).
 * At most one `active` and one `next` key; all keys share the fleet's issuer id.
 */
export class FleetSigningKeys1810000000001 implements MigrationInterface {
  name = 'FleetSigningKeys1810000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_signing_keys" (
        "kid" varchar(64) NOT NULL,
        "issuer" varchar(128) NOT NULL,
        "public_key" text NOT NULL,
        "private_key" text NOT NULL,
        "state" varchar(16) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "activated_at" timestamptz,
        "retired_at" timestamptz,
        CONSTRAINT "PK_lw_fleet_signing_keys" PRIMARY KEY ("kid"),
        CONSTRAINT "CHK_lw_fleet_signing_keys_state" CHECK ("state" IN ('next', 'active', 'retired'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_fleet_signing_keys_active" ON "lw_fleet_signing_keys" ("state") WHERE "state" = 'active'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_fleet_signing_keys_next" ON "lw_fleet_signing_keys" ("state") WHERE "state" = 'next'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_signing_keys"`);
  }
}
