import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMasterKeyKms1800000000006 implements MigrationInterface {
  name = 'AddMasterKeyKms1800000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_master_keys" ADD COLUMN IF NOT EXISTS "kms" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_master_keys" DROP COLUMN IF EXISTS "kms"`);
  }
}
