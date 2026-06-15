import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Jira imports: target swimlane (stored status). Defaults to draft for existing rows.
 * Backfill empty JQL/CQL so legacy configs remain runnable under stricter validation.
 */
export class AddImportTargetTicketStatusToExternalImportConfigs1771200000000 implements MigrationInterface {
  name = 'AddImportTargetTicketStatusToExternalImportConfigs1771200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "external_import_configs"
      ADD COLUMN "import_target_ticket_status" character varying(32) NOT NULL DEFAULT 'draft'
    `);
    await queryRunner.query(`
      UPDATE "external_import_configs"
      SET "jql" = 'project IS NOT EMPTY ORDER BY updated DESC'
      WHERE "import_kind" = 'jira' AND ("jql" IS NULL OR btrim("jql") = '')
    `);
    await queryRunner.query(`
      UPDATE "external_import_configs"
      SET "cql" = 'type = page ORDER BY lastModified DESC'
      WHERE "import_kind" = 'confluence' AND ("cql" IS NULL OR btrim("cql") = '')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "external_import_configs" DROP COLUMN "import_target_ticket_status"
    `);
  }
}
