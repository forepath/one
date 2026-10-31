import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fleet service (3.24): one connection per cluster (endpoint, optional CA, the service credential encrypted with
 * `ENCRYPTION_KEY`), per-cluster / per-project grants of fleet users, the fleet's audit log and cross-cluster
 * operations (restore / clone, final backup). Users and PATs come from the identity migrations.
 */
export class CreateFleetTables1810000000000 implements MigrationInterface {
  name = 'CreateFleetTables1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_clusters" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(63) NOT NULL,
        "description" text,
        "endpoint" varchar(512) NOT NULL,
        "ca_certificate" text,
        "credential" varchar(4096) NOT NULL,
        "credential_hint" varchar(8) NOT NULL,
        "reference" varchar(255),
        "state" varchar(16) NOT NULL DEFAULT 'active',
        "read_only_until" timestamptz,
        "read_only_reason" varchar(255),
        "health" jsonb NOT NULL DEFAULT '{"state":"unknown"}',
        "created_by" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_fleet_clusters" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lw_fleet_clusters_state" CHECK ("state" IN ('active', 'teardown', 'retired'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_fleet_clusters_name" ON "lw_fleet_clusters" ("name")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_fleet_clusters_reference" ON "lw_fleet_clusters" ("reference") WHERE "reference" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_grants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "cluster_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" varchar(16) NOT NULL,
        "project" varchar(63),
        "created_by" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_fleet_grants" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lw_fleet_grants_role" CHECK ("role" IN ('viewer', 'operator', 'admin')),
        CONSTRAINT "FK_lw_fleet_grants_cluster" FOREIGN KEY ("cluster_id") REFERENCES "lw_fleet_clusters" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_lw_fleet_grants_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    // One grant per user, cluster and scope (cluster-wide = no project).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_fleet_grants_scope" ON "lw_fleet_grants" ("cluster_id", "user_id", COALESCE("project", ''))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_fleet_grants_user" ON "lw_fleet_grants" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_audit_events" (
        "seq" bigserial NOT NULL,
        "at" timestamptz NOT NULL DEFAULT now(),
        "actor_type" varchar(16) NOT NULL,
        "actor_id" varchar(255),
        "action" varchar(128) NOT NULL,
        "cluster_id" uuid,
        "target" varchar(512) NOT NULL,
        "details" jsonb NOT NULL DEFAULT '{}',
        CONSTRAINT "PK_lw_fleet_audit_events" PRIMARY KEY ("seq")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_fleet_audit_events_at" ON "lw_fleet_audit_events" ("at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_fleet_audit_events_cluster" ON "lw_fleet_audit_events" ("cluster_id", "at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_fleet_operations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" varchar(32) NOT NULL,
        "status" varchar(16) NOT NULL,
        "source_cluster_id" uuid,
        "target_cluster_id" uuid NOT NULL,
        "params" jsonb NOT NULL DEFAULT '{}',
        "steps" jsonb NOT NULL DEFAULT '[]',
        "error" text,
        "created_by" varchar(255),
        "on_behalf_of" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_fleet_operations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lw_fleet_operations_kind" CHECK ("kind" IN ('cross-cluster-restore', 'clone', 'final-backup')),
        CONSTRAINT "CHK_lw_fleet_operations_status" CHECK ("status" IN ('running', 'waiting', 'succeeded', 'failed', 'cancelled'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_fleet_operations_status" ON "lw_fleet_operations" ("status", "updated_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_fleet_operations_target" ON "lw_fleet_operations" ("target_cluster_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_operations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_audit_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_grants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_fleet_clusters"`);
  }
}
