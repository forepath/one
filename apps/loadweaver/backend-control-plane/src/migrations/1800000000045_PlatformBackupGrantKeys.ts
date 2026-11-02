import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Key-bound platform-backup delete grants (M6 review L4): WAL-G retention / deletion grants name the exact keys the
 * run may remove instead of the whole scope prefix. Null keeps the prefix-wide grant (OpenSearch snapshot deletion).
 */
export class PlatformBackupGrantKeys1800000000045 implements MigrationInterface {
  name = 'PlatformBackupGrantKeys1800000000045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_platform_backup_grants" ADD COLUMN IF NOT EXISTS "keys" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_platform_backup_grants" DROP COLUMN IF EXISTS "keys"`);
  }
}
