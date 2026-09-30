import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Store models.dev model id/name pairs on each cached provider row.
 */
export class AddModelsToOpencodeProvidersTable1774700000000 implements MigrationInterface {
  name = 'AddModelsToOpencodeProvidersTable1774700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "opencode_providers" ADD COLUMN IF NOT EXISTS "models" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "opencode_providers" DROP COLUMN IF EXISTS "models"`);
  }
}
