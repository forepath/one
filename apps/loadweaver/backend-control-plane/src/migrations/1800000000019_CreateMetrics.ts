import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Time series (3.13, 3.18): 10 s samples, flows and events. Plain tables here; on TimescaleDB the control plane turns
 * the raw tables into hypertables and the roll-ups into continuous aggregates when it starts (MetricsStore).
 */
export class CreateMetrics1800000000019 implements MigrationInterface {
  name = 'CreateMetrics1800000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_metrics" (
        "time" TIMESTAMPTZ NOT NULL,
        "metric" varchar(64) NOT NULL,
        "node" varchar(63) NOT NULL,
        "project" varchar(63),
        "entity" varchar(255) NOT NULL DEFAULT '',
        "value" double precision NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_metrics_series" ON "lw_metrics" ("metric", "entity", "time" DESC)`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_metrics_time" ON "lw_metrics" ("time" DESC)`);
    for (const bucket of ['1m', '1h'])
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "lw_metrics_${bucket}" (
          "bucket" TIMESTAMPTZ NOT NULL,
          "metric" varchar(64) NOT NULL,
          "node" varchar(63) NOT NULL,
          "project" varchar(63),
          "entity" varchar(255) NOT NULL DEFAULT '',
          "avg" double precision NOT NULL,
          "min" double precision NOT NULL,
          "max" double precision NOT NULL,
          "samples" bigint NOT NULL,
          CONSTRAINT "PK_lw_metrics_${bucket}" PRIMARY KEY ("metric", "node", "entity", "bucket")
        )
      `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_flows" (
        "time" TIMESTAMPTZ NOT NULL,
        "node" varchar(63) NOT NULL,
        "policy" varchar(255) NOT NULL DEFAULT '',
        "src" varchar(255) NOT NULL,
        "dst" varchar(255) NOT NULL,
        "src_project" varchar(63),
        "dst_project" varchar(63),
        "protocol" varchar(8) NOT NULL,
        "port" integer NOT NULL DEFAULT 0,
        "decision" varchar(16) NOT NULL,
        "packets" bigint NOT NULL DEFAULT 0,
        "bytes" bigint NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_flows_time" ON "lw_flows" ("time" DESC)`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_flows_1h" (
        "bucket" TIMESTAMPTZ NOT NULL,
        "node" varchar(63) NOT NULL,
        "policy" varchar(255) NOT NULL DEFAULT '',
        "src" varchar(255) NOT NULL,
        "dst" varchar(255) NOT NULL,
        "src_project" varchar(63),
        "dst_project" varchar(63),
        "protocol" varchar(8) NOT NULL,
        "port" integer NOT NULL DEFAULT 0,
        "decision" varchar(16) NOT NULL,
        "packets" bigint NOT NULL,
        "bytes" bigint NOT NULL,
        CONSTRAINT "PK_lw_flows_1h" PRIMARY KEY ("node", "policy", "src", "dst", "protocol", "port", "decision", "bucket")
      )
    `);
    // Event markers on graphs (3.18): applies, migrations, failovers, node join / leave, renewals, health changes.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "time" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "kind" varchar(64) NOT NULL,
        "entity" varchar(255) NOT NULL DEFAULT '',
        "project" varchar(63),
        "message" text NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}'
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_events_time" ON "lw_events" ("time" DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['lw_events', 'lw_flows_1h', 'lw_flows', 'lw_metrics_1h', 'lw_metrics_1m', 'lw_metrics'])
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
}
