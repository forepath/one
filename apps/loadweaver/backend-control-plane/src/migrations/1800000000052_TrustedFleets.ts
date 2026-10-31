import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Approvals through the fleet (3.24): trusted fleets (Ed25519 public keys registered natively by cluster admins),
 * the persons who acted through them (verified email for the two-person rules) and the claim nonces (replay
 * protection shared by every control-plane replica).
 */
export class TrustedFleets1800000000052 implements MigrationInterface {
  name = 'TrustedFleets1800000000052';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_trusted_fleets" (
        "issuer" varchar(128) NOT NULL,
        "name" varchar(255) NOT NULL,
        "keys" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_by" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_trusted_fleets" PRIMARY KEY ("issuer")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_persons" (
        "person_id" varchar(255) NOT NULL,
        "issuer" varchar(128) NOT NULL,
        "subject" varchar(128) NOT NULL,
        "email" varchar(320),
        "email_verified" boolean NOT NULL DEFAULT false,
        "last_seen_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_fleet_persons" PRIMARY KEY ("person_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_fleet_persons_email" ON "lw_fleet_persons" (lower("email")) WHERE "email_verified"`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_claim_nonces" (
        "issuer" varchar(128) NOT NULL,
        "jti" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        CONSTRAINT "PK_lw_fleet_claim_nonces" PRIMARY KEY ("issuer", "jti")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_fleet_claim_nonces_expires" ON "lw_fleet_claim_nonces" ("expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_claim_nonces"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_persons"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_trusted_fleets"`);
  }
}
