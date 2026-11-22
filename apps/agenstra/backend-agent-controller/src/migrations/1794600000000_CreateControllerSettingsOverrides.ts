import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Console overrides of controller settings (Administration → Settings). One row per overridden environment
 * variable; `value` is AES-256-GCM encrypted by the entity transformer. Deleting a row lets the environment
 * variable apply again.
 */
export class CreateControllerSettingsOverrides1794600000000 implements MigrationInterface {
  name = 'CreateControllerSettingsOverrides1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "controller_settings_overrides" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "setting_key" VARCHAR(128) NOT NULL,
        "value" TEXT NOT NULL,
        "updated_by_user_id" UUID NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_controller_settings_overrides_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_controller_settings_overrides_setting_key_unique" ON "controller_settings_overrides" ("setting_key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_controller_settings_overrides_setting_key_unique"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "controller_settings_overrides"`);
  }
}
