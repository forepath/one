import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add entry_kind for directory markers; allow null content (dirs) while file bodies stay GCM-encrypted text.
 * Wipe existing rows — table was new and plaintext content is incompatible with the GCM transformer.
 */
export class AlterOpencodeLayerFilesEntryKind1774500001000 implements MigrationInterface {
  name = 'AlterOpencodeLayerFilesEntryKind1774500001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "opencode_layer_file_sync_targets"`);
    await queryRunner.query(`DELETE FROM "opencode_layer_files"`);
    await queryRunner.query(
      `ALTER TABLE "opencode_layer_files" ADD COLUMN IF NOT EXISTS "entry_kind" varchar(16) NOT NULL DEFAULT 'file'`,
    );
    await queryRunner.query(`ALTER TABLE "opencode_layer_files" ALTER COLUMN "content" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "opencode_layer_file_sync_targets"`);
    await queryRunner.query(`DELETE FROM "opencode_layer_files"`);
    await queryRunner.query(`ALTER TABLE "opencode_layer_files" ALTER COLUMN "content" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "opencode_layer_files" DROP COLUMN IF EXISTS "entry_kind"`);
  }
}
