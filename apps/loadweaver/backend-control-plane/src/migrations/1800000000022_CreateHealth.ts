import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHealth1800000000022 implements MigrationInterface {
  name = 'CreateHealth1800000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The explained health tree (3.25): the current state of every entity and since when; changes are events.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_health" (
        "key" varchar(300) PRIMARY KEY,
        "kind" varchar(16) NOT NULL,
        "name" varchar(255) NOT NULL,
        "parent" varchar(300),
        "project" varchar(63),
        "state" varchar(16) NOT NULL,
        "reasons" jsonb NOT NULL DEFAULT '[]',
        "since" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_health_project" ON "lw_health" ("project")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_events_entity" ON "lw_events" ("entity", "time" DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lw_events_entity"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_health"`);
  }
}
