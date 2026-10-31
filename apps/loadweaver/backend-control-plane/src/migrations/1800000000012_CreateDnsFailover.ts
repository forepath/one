import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDnsFailover1800000000012 implements MigrationInterface {
  name = 'CreateDnsFailover1800000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_probe_results" (
        "probe_id" varchar(192) NOT NULL,
        "node" varchar(63) NOT NULL,
        "ok" boolean NOT NULL,
        "latency_ms" integer,
        "error" varchar(256),
        "at" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_lw_probe_results" PRIMARY KEY ("probe_id", "node")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_dns_failover_state" (
        "name" varchar(63) PRIMARY KEY,
        "state" jsonb NOT NULL,
        "switched_at" TIMESTAMPTZ,
        "failback_confirmed" boolean NOT NULL DEFAULT false
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_dns_failover_state"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_probe_results"`);
  }
}
