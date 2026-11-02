import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkloadTables1800000000001 implements MigrationInterface {
  name = 'CreateWorkloadTables1800000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_workload_placements" (
        "id" varchar(256) NOT NULL,
        "project" varchar(63) NOT NULL,
        "deployment" varchar(63) NOT NULL,
        "service" varchar(63) NOT NULL,
        "node" varchar(63) NOT NULL,
        "addresses" jsonb NOT NULL DEFAULT '[]',
        "spec_hash" varchar(64),
        "status" jsonb,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_workload_placements" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_workload_placements_node" ON "lw_workload_placements" ("node")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_service_addresses" (
        "id" varchar(200) NOT NULL,
        "address_v4" varchar(45),
        "address_v6" varchar(45),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_service_addresses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lw_service_addresses_v4" UNIQUE ("address_v4"),
        CONSTRAINT "UQ_lw_service_addresses_v6" UNIQUE ("address_v6")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_volume_placements" (
        "id" varchar(200) NOT NULL,
        "primary_node" varchar(63) NOT NULL,
        "sync_replicas" jsonb NOT NULL DEFAULT '[]',
        "remote_replicas" jsonb NOT NULL DEFAULT '[]',
        "size_bytes" bigint NOT NULL,
        "cross_site" varchar(8) NOT NULL,
        "drbd_minor" integer NOT NULL,
        "drbd_port" integer NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_volume_placements" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lw_volume_placements_minor" UNIQUE ("drbd_minor")
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "lw_plans" ADD COLUMN IF NOT EXISTS "workload_changes" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(`ALTER TABLE "lw_plans" ADD COLUMN IF NOT EXISTS "failure_analysis" jsonb`);
    await queryRunner.query(`ALTER TABLE "lw_plans" ADD COLUMN IF NOT EXISTS "warnings" jsonb NOT NULL DEFAULT '[]'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_plans" DROP COLUMN IF EXISTS "warnings"`);
    await queryRunner.query(`ALTER TABLE "lw_plans" DROP COLUMN IF EXISTS "failure_analysis"`);
    await queryRunner.query(`ALTER TABLE "lw_plans" DROP COLUMN IF EXISTS "workload_changes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_volume_placements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_service_addresses"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lw_workload_placements_node"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_workload_placements"`);
  }
}
