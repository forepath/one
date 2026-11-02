import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIncidents1800000000023 implements MigrationInterface {
  name = 'CreateIncidents1800000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Incident notes of a project (3.25): shown on its public status page, part of reports.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_incidents" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "project" varchar(63) NOT NULL,
        "title" varchar(255) NOT NULL,
        "status" varchar(16) NOT NULL,
        "updates" jsonb NOT NULL DEFAULT '[]',
        "created_by" varchar(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "resolved_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_incidents_project" ON "lw_incidents" ("project", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_incidents"`);
  }
}
