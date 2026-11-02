import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDnsFailoverPropagation1800000000013 implements MigrationInterface {
  name = 'AddDnsFailoverPropagation1800000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_dns_failover_state" ADD COLUMN IF NOT EXISTS "propagation" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_dns_failover_state" DROP COLUMN IF EXISTS "propagation"`);
  }
}
