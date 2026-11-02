import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Posture integrations (3.31, P4): MDM / EDR integrations (configuration encrypted at rest, sync state), the trust
 * settings for device certificates, and per client the latest integration results plus the certificate the cluster
 * CA issued last.
 */
export class CreatePostureIntegrations1800000000047 implements MigrationInterface {
  name = 'CreatePostureIntegrations1800000000047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_posture_integrations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(32) NOT NULL,
        "type" varchar(63) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "config" text NOT NULL,
        "match_by" text[] NOT NULL,
        "interval_minutes" integer NOT NULL DEFAULT 30 CHECK ("interval_minutes" BETWEEN 5 AND 1440),
        "max_age_minutes" integer NOT NULL DEFAULT 1440 CHECK ("max_age_minutes" BETWEEN 10 AND 10080),
        "next_sync_at" timestamptz,
        "sync_started_at" timestamptz,
        "last_sync_at" timestamptz,
        "last_success_at" timestamptz,
        "last_error" varchar(300),
        "failures" integer NOT NULL DEFAULT 0,
        "vendor_devices" integer NOT NULL DEFAULT 0,
        "matched_devices" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_posture_integrations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lw_posture_integrations_name" UNIQUE ("name")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_posture_integrations_due" ON "lw_posture_integrations" ("next_sync_at") WHERE "enabled"`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_posture_certificate_trust" (
        "id" varchar(16) NOT NULL,
        "company_ca_pem" text,
        "crl_pem" text,
        "trust_cluster_ca" boolean NOT NULL DEFAULT true,
        "require_proof" boolean NOT NULL DEFAULT true,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_posture_certificate_trust" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "lw_vpn_clients" ADD COLUMN IF NOT EXISTS "integration_posture" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(`ALTER TABLE "lw_vpn_clients" ADD COLUMN IF NOT EXISTS "certificate_serial" varchar(64)`);
    await queryRunner.query(
      `ALTER TABLE "lw_vpn_clients" ADD COLUMN IF NOT EXISTS "certificate_not_after" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_vpn_clients" DROP COLUMN IF EXISTS "certificate_not_after"`);
    await queryRunner.query(`ALTER TABLE "lw_vpn_clients" DROP COLUMN IF EXISTS "certificate_serial"`);
    await queryRunner.query(`ALTER TABLE "lw_vpn_clients" DROP COLUMN IF EXISTS "integration_posture"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_posture_certificate_trust"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_posture_integrations"`);
  }
}
