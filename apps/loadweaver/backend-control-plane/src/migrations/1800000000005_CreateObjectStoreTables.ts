import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateObjectStoreTables1800000000005 implements MigrationInterface {
  name = 'CreateObjectStoreTables1800000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_object_store_generations" (
        "generation" integer PRIMARY KEY,
        "replication_factor" integer NOT NULL,
        "state" varchar(16) NOT NULL,
        "holders" jsonb NOT NULL DEFAULT '[]',
        "garage_nodes" jsonb NOT NULL DEFAULT '{}',
        "observed_members" jsonb NOT NULL DEFAULT '[]',
        "observed_since" TIMESTAMPTZ NOT NULL,
        "state_changed_at" TIMESTAMPTZ NOT NULL,
        "copy" jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // At most one generation is active at a time.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_object_store_active" ON "lw_object_store_generations" ("state") WHERE "state" = 'active'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_object_store_generations"`);
  }
}
