import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * VM image catalog (3.42): imports verify a SHA-512 as an alternative to the SHA-256 (Debian and Alpine publish
 * SHA-512 only). Exactly one of the two is set per import.
 */
export class VmImageImportSha5121800000000056 implements MigrationInterface {
  name = 'VmImageImportSha5121800000000056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_vm_image_imports" ADD COLUMN IF NOT EXISTS "sha512" varchar(128)`);
    await queryRunner.query(`ALTER TABLE "lw_vm_image_imports" ALTER COLUMN "sha256" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "lw_vm_image_imports" WHERE "sha256" IS NULL`);
    await queryRunner.query(`ALTER TABLE "lw_vm_image_imports" ALTER COLUMN "sha256" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "lw_vm_image_imports" DROP COLUMN IF EXISTS "sha512"`);
  }
}
