import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Silences of the shared action center (Decabill and Agenstra). Rows of deleted users disappear with them; silences
 * for everyone keep working when their author is deleted.
 */
export class CreateActionCenterSilences1795300000000 implements MigrationInterface {
  name = 'CreateActionCenterSilences1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "action_center_silences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "scope_key" varchar(64) NOT NULL,
        "user_id" uuid NULL,
        "item_type" varchar(128) NOT NULL,
        "item_id" varchar(128) NULL,
        "until" timestamptz NULL,
        "created_by_user_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_action_center_silences_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_action_center_silences_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_action_center_silences_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_action_center_silences_scope" ON "action_center_silences" ("scope_key")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_action_center_silences_target"
      ON "action_center_silences" (
        "scope_key",
        COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid),
        "item_type",
        COALESCE("item_id", '')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "action_center_silences"`);
  }
}
