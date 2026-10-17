import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReports1800000000026 implements MigrationInterface {
  name = 'CreateReports1800000000026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Monthly reports (3.25), one per scope (cluster or project) and month; the files live in the file storage.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_reports" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "scope" varchar(63) NOT NULL,
        "period_year" integer NOT NULL,
        "period_month" integer NOT NULL,
        "status" varchar(16) NOT NULL,
        "files" jsonb NOT NULL DEFAULT '[]',
        "error" varchar(1000),
        "triggered_by" varchar(255),
        "started_at" TIMESTAMPTZ,
        "completed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_lw_reports_period" UNIQUE ("scope", "period_year", "period_month")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_reports"`);
  }
}
