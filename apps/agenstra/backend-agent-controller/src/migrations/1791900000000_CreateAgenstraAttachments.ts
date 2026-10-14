import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgenstraAttachments1791900000000 implements MigrationInterface {
  name = 'CreateAgenstraAttachments1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agenstra_attachments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "client_id" uuid NOT NULL,
        "owner_type" character varying(32) NOT NULL,
        "owner_id" uuid NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "content_type" character varying(255) NOT NULL,
        "byte_size" bigint NOT NULL,
        "storage_key" character varying(512) NOT NULL,
        "content_sha256" character varying(64) NOT NULL,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agenstra_attachments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agenstra_attachments_client" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agenstra_attachments_user" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agenstra_attachments_client" ON "agenstra_attachments" ("client_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agenstra_attachments_owner" ON "agenstra_attachments" ("owner_type", "owner_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agenstra_attachments"`);
  }
}
