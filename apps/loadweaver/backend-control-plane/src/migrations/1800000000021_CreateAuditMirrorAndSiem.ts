import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditMirrorAndSiem1800000000021 implements MigrationInterface {
  name = 'CreateAuditMirrorAndSiem1800000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // How far the audit log is mirrored to the log store and when its chain head was last anchored (3.18).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_audit_mirror" (
        "id" smallint PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
        "mirrored_seq" bigint NOT NULL DEFAULT 0,
        "anchored_seq" bigint NOT NULL DEFAULT 0,
        "anchored_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`INSERT INTO "lw_audit_mirror" ("id") VALUES (1) ON CONFLICT DO NOTHING`);
    // Per SIEM target: what was forwarded (audit sequence, log cursor) and its delivery state.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_siem_cursors" (
        "name" varchar(63) PRIMARY KEY,
        "audit_seq" bigint NOT NULL DEFAULT 0,
        "logs_after" text,
        "forwarded" bigint NOT NULL DEFAULT 0,
        "failures" integer NOT NULL DEFAULT 0,
        "last_error" varchar(1000),
        "next_attempt_at" TIMESTAMPTZ,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_siem_cursors"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_audit_mirror"`);
  }
}
