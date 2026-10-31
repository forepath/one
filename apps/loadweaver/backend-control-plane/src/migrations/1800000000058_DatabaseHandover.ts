import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Control-plane database handover (3.43): where the cluster's database lives for an external control plane
 * (`external` → `handover` → `members`) and the external copy's last state. One row (`id = 'cluster'`), copied with the
 * data and replicated to the external copy, so both databases agree; the control plane's own knowledge of the
 * connection it uses is the target file on its state volume (`database-target.json`).
 */
export class DatabaseHandover1800000000058 implements MigrationInterface {
  name = 'DatabaseHandover1800000000058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "lw_database_handover" (
      "id" varchar(16) PRIMARY KEY DEFAULT 'cluster',
      "state" varchar(16) NOT NULL,
      "handover_id" uuid,
      "external_copy" jsonb,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_lw_database_handover_state" CHECK ("state" IN ('external', 'handover', 'members'))
    )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_database_handover"`);
  }
}
