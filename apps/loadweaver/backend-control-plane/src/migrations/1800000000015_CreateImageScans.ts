import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateImageScans1800000000015 implements MigrationInterface {
  name = 'CreateImageScans1800000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_image_scans" (
        "digest" varchar(80) PRIMARY KEY,
        "image" varchar(512) NOT NULL,
        "scanned_at" TIMESTAMPTZ NOT NULL,
        "node" varchar(63) NOT NULL,
        "scanner" varchar(64) NOT NULL,
        "summary" jsonb NOT NULL,
        "findings" jsonb NOT NULL DEFAULT '[]'
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_image_scans"`);
  }
}
