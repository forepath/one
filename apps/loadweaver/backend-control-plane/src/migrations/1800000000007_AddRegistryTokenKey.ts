import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRegistryTokenKey1800000000007 implements MigrationInterface {
  name = 'AddRegistryTokenKey1800000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_cluster" ADD COLUMN IF NOT EXISTS "registry_token_certificate" text`);
    await queryRunner.query(`ALTER TABLE "lw_cluster" ADD COLUMN IF NOT EXISTS "registry_token_private_key" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_cluster" DROP COLUMN IF EXISTS "registry_token_private_key"`);
    await queryRunner.query(`ALTER TABLE "lw_cluster" DROP COLUMN IF EXISTS "registry_token_certificate"`);
  }
}
