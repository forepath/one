import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkspaceConfigurationOverridesTable1773000000000 implements MigrationInterface {
  name = 'CreateWorkspaceConfigurationOverridesTable1773000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_configuration_overrides" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "setting_key" varchar(64) NOT NULL,
        "value" text NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workspace_configuration_overrides_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_workspace_configuration_overrides_setting_key_unique"
      ON "workspace_configuration_overrides" ("setting_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workspace_configuration_overrides_setting_key_unique"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_configuration_overrides"`);
  }
}
