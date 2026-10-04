import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingStoredFilesContentSha256Index1778100000000 implements MigrationInterface {
  name = 'AddBillingStoredFilesContentSha256Index1778100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_stored_files_content_sha256"
      ON "billing_stored_files" ("content_sha256")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_stored_files_content_sha256"`);
  }
}
