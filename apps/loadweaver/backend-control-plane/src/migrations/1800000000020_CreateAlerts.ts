import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAlerts1800000000020 implements MigrationInterface {
  name = 'CreateAlerts1800000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Alert state (3.18): one open alert per rule and series key; resolved ones stay as history.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_alerts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "rule" varchar(255) NOT NULL,
        "key" varchar(255) NOT NULL DEFAULT '',
        "project" varchar(63),
        "severity" varchar(16) NOT NULL,
        "state" varchar(16) NOT NULL,
        "title" varchar(512) NOT NULL,
        "message" text NOT NULL,
        "value" double precision,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "fired_at" TIMESTAMPTZ,
        "resolved_at" TIMESTAMPTZ,
        "notified_at" TIMESTAMPTZ,
        "escalated_at" TIMESTAMPTZ,
        "silenced" boolean NOT NULL DEFAULT false,
        "acknowledged_by" varchar(255),
        "acknowledged_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lw_alerts_open" ON "lw_alerts" ("rule", "key") WHERE "state" <> 'resolved'`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_alerts_started" ON "lw_alerts" ("started_at" DESC)`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_alert_silences" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "rule" varchar(255),
        "project" varchar(63),
        "key" varchar(255),
        "reason" varchar(1024) NOT NULL,
        "created_by" varchar(255),
        "starts_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "ends_at" TIMESTAMPTZ NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_alert_silences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_alerts"`);
  }
}
