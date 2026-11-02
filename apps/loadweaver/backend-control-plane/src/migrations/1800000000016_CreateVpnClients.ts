import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVpnClients1800000000016 implements MigrationInterface {
  name = 'CreateVpnClients1800000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_vpn_clients" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "kind" varchar(16) NOT NULL,
        "name" varchar(63) NOT NULL,
        "user_id" varchar(255),
        "owner_label" varchar(255) NOT NULL,
        "public_key" varchar(44) NOT NULL UNIQUE,
        "address" varchar(45) NOT NULL,
        "subnets" text[] NOT NULL DEFAULT '{}',
        "groups" text[] NOT NULL DEFAULT '{}',
        "posture" jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "renewed_at" TIMESTAMPTZ NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "revoked_at" TIMESTAMPTZ,
        "last_handshake_at" TIMESTAMPTZ,
        "last_endpoint" varchar(64),
        "last_gateway" varchar(63)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_lw_vpn_clients_user" ON "lw_vpn_clients" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_lw_vpn_clients_address" ON "lw_vpn_clients" ("address")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_vpn_gateway_keys" (
        "id" varchar(16) PRIMARY KEY,
        "public_key" varchar(44) NOT NULL,
        "private_key" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_vpn_gateway_keys"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_vpn_clients"`);
  }
}
