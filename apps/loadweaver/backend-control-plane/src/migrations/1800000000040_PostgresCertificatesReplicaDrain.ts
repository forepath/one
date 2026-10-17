import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M6 gate items: members' Postgres server certificates are stored and reused until a third of their lifetime is left
 * (`lw_postgres_certificates`, private key encrypted with the cluster encryption key), and removed replicas drain
 * before they stop (`lw_workload_placements.drain_until`: out of routing, still running until then).
 */
export class PostgresCertificatesReplicaDrain1800000000040 implements MigrationInterface {
  name = 'PostgresCertificatesReplicaDrain1800000000040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_postgres_certificates" (
        "node_name" varchar(63) PRIMARY KEY,
        "serial" varchar(64) NOT NULL,
        "address" varchar(45) NOT NULL,
        "certificate_pem" text NOT NULL,
        "private_key" text NOT NULL,
        "ca_fingerprint" varchar(64) NOT NULL,
        "not_before" timestamptz NOT NULL,
        "not_after" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" ADD COLUMN IF NOT EXISTS "drain_until" timestamptz`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_workload_placements_drain_until" ON "lw_workload_placements" ("drain_until") WHERE "drain_until" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lw_workload_placements_drain_until"`);
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" DROP COLUMN IF EXISTS "drain_until"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_postgres_certificates"`);
  }
}
