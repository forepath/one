import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDnsZoneStatus1800000000010 implements MigrationInterface {
  name = 'CreateDnsZoneStatus1800000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_dns_zone_status" (
        "zone" varchar(63) NOT NULL,
        "provider" varchar(63) NOT NULL,
        "synced_at" TIMESTAMPTZ,
        "error" varchar(1000),
        "conflicts" jsonb NOT NULL DEFAULT '[]',
        "changes" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_lw_dns_zone_status" PRIMARY KEY ("zone", "provider")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_dns_zone_status"`);
  }
}
