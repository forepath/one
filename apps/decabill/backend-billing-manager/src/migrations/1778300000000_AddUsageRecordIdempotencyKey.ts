import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collector samples may carry an idempotency key (e.g. Loadweaver usage per project, meter and hour), stored as
 * `usage_payload.idempotencyKey`: unique per subscription and meter, so overlapping collect windows never bill twice.
 */
export class AddUsageRecordIdempotencyKey1778300000000 implements MigrationInterface {
  name = 'AddUsageRecordIdempotencyKey1778300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_billing_usage_records_idempotency_key"
      ON "billing_usage_records" ("subscription_id", "meter_id", ("usage_payload" ->> 'idempotencyKey'))
      WHERE "meter_id" IS NOT NULL AND ("usage_payload" ->> 'idempotencyKey') IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_billing_usage_records_idempotency_key"`);
  }
}
