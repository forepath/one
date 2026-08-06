import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenMeterAggregatorColumn1776200000000 implements MigrationInterface {
  name = 'WidenMeterAggregatorColumn1776200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_meters"
      ALTER COLUMN "aggregator" TYPE character varying(32)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_meters"
      ALTER COLUMN "aggregator" TYPE character varying(16)
    `);
  }
}
