import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMigrationHistory1800000000031 implements MigrationInterface {
  name = 'CreateMigrationHistory1800000000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Live migration (3.10): one row per attempt; checkpoint attempts are also the session record.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_migrations" (
        "id" uuid PRIMARY KEY,
        "replica" varchar(256) NOT NULL,
        "project" varchar(63) NOT NULL,
        "deployment" varchar(63) NOT NULL,
        "from_node" varchar(63) NOT NULL,
        "to_node" varchar(63) NOT NULL,
        "method" varchar(16) NOT NULL,
        "attempt" integer NOT NULL,
        "phase" varchar(16) NOT NULL,
        "reason" varchar(16) NOT NULL,
        "method_label" varchar(512) NOT NULL,
        "fallback_reason" varchar(2048),
        "freeze_ms" integer,
        "checkpoint_bytes" bigint,
        "precopy_rounds" integer,
        "runtime" varchar(8),
        "addresses" jsonb NOT NULL DEFAULT '[]',
        "volumes" jsonb NOT NULL DEFAULT '[]',
        "spec" jsonb,
        "token" varchar(64),
        "reports" jsonb NOT NULL DEFAULT '{}',
        "restore_sent" boolean NOT NULL DEFAULT false,
        "phase_started_at" TIMESTAMPTZ NOT NULL,
        "started_at" TIMESTAMPTZ NOT NULL,
        "finished_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_migrations_replica" ON "lw_migrations" ("replica", "started_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_migrations_deployment" ON "lw_migrations" ("project", "deployment", "started_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_migrations_active" ON "lw_migrations" ("started_at") WHERE "finished_at" IS NULL`,
    );
    // The negotiated agent protocol (3.26): live migration needs the `live-migration` feature on both nodes.
    await queryRunner.query(
      `ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "protocol_version" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "protocol_features" jsonb NOT NULL DEFAULT '[]'`,
    );
    // Replicas restored from a checkpoint run agent-managed until their next restart.
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" ADD COLUMN IF NOT EXISTS "restored" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_workload_placements" DROP COLUMN IF EXISTS "restored"`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "protocol_features"`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "protocol_version"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_migrations"`);
  }
}
