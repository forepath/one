import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePublicAddresses1800000000008 implements MigrationInterface {
  name = 'CreatePublicAddresses1800000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_public_addresses" (
        "address" varchar(45) PRIMARY KEY,
        "pool" varchar(63) NOT NULL,
        "purpose" varchar(16) NOT NULL,
        "owner" varchar(128),
        "state" varchar(16) NOT NULL,
        "released_at" TIMESTAMPTZ,
        "holder" varchar(63),
        "vrid" integer,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_lw_public_addresses_owner" UNIQUE ("owner")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_public_addresses_vrid" ON "lw_public_addresses" ("vrid") WHERE "vrid" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_public_addresses"`);
  }
}
