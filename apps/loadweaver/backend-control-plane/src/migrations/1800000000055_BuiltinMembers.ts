import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Built-in control-plane member (3.39): its public seal key (the private key stays on the control-plane state volume)
 * and the standby copy of the master key sealed to it.
 */
export class BuiltinMembers1800000000055 implements MigrationInterface {
  name = 'BuiltinMembers1800000000055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_builtin_members" (
        "id" varchar(32) NOT NULL,
        "seal_public_key" varchar(64) NOT NULL,
        "mode" varchar(16) NOT NULL,
        "instance" varchar(255),
        "last_seen_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_builtin_members" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`ALTER TABLE "lw_master_keys" ADD COLUMN IF NOT EXISTS "builtin_standby" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_master_keys" DROP COLUMN IF EXISTS "builtin_standby"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_builtin_members"`);
  }
}
