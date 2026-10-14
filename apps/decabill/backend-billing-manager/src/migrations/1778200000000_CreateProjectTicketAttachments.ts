import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectTicketAttachments1778200000000 implements MigrationInterface {
  name = 'CreateProjectTicketAttachments1778200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_project_ticket_attachments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ticket_id" uuid NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "content_type" character varying(255) NOT NULL,
        "byte_size" bigint NOT NULL,
        "storage_key" character varying(512) NOT NULL,
        "stored_file_id" uuid,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_project_ticket_attachments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_project_ticket_attachments_ticket" FOREIGN KEY ("ticket_id") REFERENCES "billing_project_tickets"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_billing_project_ticket_attachments_user" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_billing_project_ticket_attachments_ticket" ON "billing_project_ticket_attachments" ("ticket_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_project_ticket_attachments"`);
  }
}
