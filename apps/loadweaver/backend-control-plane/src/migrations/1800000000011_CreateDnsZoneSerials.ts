import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDnsZoneSerials1800000000011 implements MigrationInterface {
  name = 'CreateDnsZoneSerials1800000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_dns_zone_serials" (
        "zone" varchar(63) PRIMARY KEY,
        "serial" bigint NOT NULL,
        "content_hash" varchar(64) NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_dns_zone_serials"`);
  }
}
