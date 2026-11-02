import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Horizontal autoscaling (3.23, M6 step 6): per autoscaled service the replica count the planner uses, the last
 * scaling action (time, reason, metric value), the recommendations of the scale-down stabilisation window and the
 * last evaluation's status (incl. why a scale-up is blocked).
 */
export class CreateAutoscaleState1800000000038 implements MigrationInterface {
  name = 'CreateAutoscaleState1800000000038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_autoscale_state" (
        "service_key" varchar(255) PRIMARY KEY,
        "project" varchar(63) NOT NULL,
        "replicas" integer NOT NULL CHECK ("replicas" >= 0),
        "last_scale_at" timestamptz,
        "last_reason" text,
        "last_value" double precision,
        "recommendations" jsonb NOT NULL DEFAULT '[]',
        "status" jsonb,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_autoscale_state_project" ON "lw_autoscale_state" ("project")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_autoscale_state"`);
  }
}
