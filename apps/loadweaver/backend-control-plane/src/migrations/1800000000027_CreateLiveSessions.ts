import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLiveSessions1800000000027 implements MigrationInterface {
  name = 'CreateLiveSessions1800000000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Which control-plane replica holds a node's stream: live sessions are relayed there (3.19).
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "stream_owner" varchar(64)`);
    // Per project: record terminal sessions (3.19).
    await queryRunner.query(
      `ALTER TABLE "lw_project_settings" ADD COLUMN IF NOT EXISTS "record_terminals" boolean NOT NULL DEFAULT false`,
    );
    // Wallboard tokens (3.25) stay bound to why their creator could create them and to the projects' identity.
    await queryRunner.query(`ALTER TABLE "lw_wallboard_tokens" ADD COLUMN IF NOT EXISTS "creator_basis" varchar(32)`);
    await queryRunner.query(`ALTER TABLE "lw_wallboard_tokens" ADD COLUMN IF NOT EXISTS "project_ids" jsonb`);
    // Relay messages too large for NOTIFY; deleted when read, swept after a minute.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_live_relay" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "body" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Terminal sessions (metadata always, the recording if the policy says so) and debug tunnels.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_terminal_sessions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" varchar(255),
        "project" varchar(63),
        "target" varchar(300) NOT NULL,
        "node" varchar(63) NOT NULL,
        "recorded" boolean NOT NULL DEFAULT false,
        "recording_key" varchar(512),
        "exit_code" integer,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "seen_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "ended_at" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_terminal_sessions_started" ON "lw_terminal_sessions" ("started_at" DESC)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_tunnels" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" varchar(255),
        "project" varchar(63) NOT NULL,
        "replica" varchar(300) NOT NULL,
        "node" varchar(63) NOT NULL,
        "port" integer NOT NULL,
        "opened_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMPTZ NOT NULL,
        "seen_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "closed_at" TIMESTAMPTZ
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_tunnels"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_terminal_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_live_relay"`);
    await queryRunner.query(`ALTER TABLE "lw_wallboard_tokens" DROP COLUMN IF EXISTS "project_ids"`);
    await queryRunner.query(`ALTER TABLE "lw_wallboard_tokens" DROP COLUMN IF EXISTS "creator_basis"`);
    await queryRunner.query(`ALTER TABLE "lw_project_settings" DROP COLUMN IF EXISTS "record_terminals"`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "stream_owner"`);
  }
}
