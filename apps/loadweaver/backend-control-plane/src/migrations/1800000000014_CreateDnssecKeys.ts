import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDnssecKeys1800000000014 implements MigrationInterface {
  name = 'CreateDnssecKeys1800000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_dnssec_keys" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "zone" varchar(63) NOT NULL,
        "key_tag" integer NOT NULL,
        "public_key" text NOT NULL,
        "private_key" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "retired_at" TIMESTAMPTZ,
        "ds_at_parent" boolean NOT NULL DEFAULT false,
        "ds_absent_since" TIMESTAMPTZ,
        "ds_present_since" TIMESTAMPTZ,
        "ds_checked_at" TIMESTAMPTZ,
        CONSTRAINT "PK_lw_dnssec_keys" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_dnssec_keys_zone" ON "lw_dnssec_keys" ("zone")`);
    // Secondary sync state (3.15: the plan warns when a secondary drifted from the primary).
    await queryRunner.query(`ALTER TABLE "lw_dns_zone_status" ADD COLUMN IF NOT EXISTS "drift" varchar(512)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_dns_zone_status" DROP COLUMN IF EXISTS "drift"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_dnssec_keys"`);
  }
}
