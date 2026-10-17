import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateControlPlaneTables1800000000000 implements MigrationInterface {
  name = 'CreateControlPlaneTables1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_cluster" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "cluster_id" varchar(63) NOT NULL,
        "display_name" varchar(255) NOT NULL,
        "ca_certificate" text NOT NULL,
        "ca_private_key" text NOT NULL,
        "network_state" jsonb NOT NULL DEFAULT '{}',
        "desired_revision" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_cluster" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lw_cluster_cluster_id" UNIQUE ("cluster_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_resources" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kind" varchar(64) NOT NULL,
        "project" varchar(63),
        "project_key" varchar(63) NOT NULL DEFAULT '',
        "name" varchar(63) NOT NULL,
        "labels" jsonb NOT NULL DEFAULT '{}',
        "annotations" jsonb NOT NULL DEFAULT '{}',
        "spec" jsonb NOT NULL,
        "generation" integer NOT NULL DEFAULT 1,
        "updated_by" varchar(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_resources" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lw_resources_project_key" CHECK ("project_key" = COALESCE("project", ''))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lw_resources_identity" ON "lw_resources" ("kind", "project_key", "name")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_nodes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(63) NOT NULL,
        "site" varchar(63) NOT NULL,
        "lifecycle" varchar(16) NOT NULL DEFAULT 'active',
        "labels" jsonb NOT NULL DEFAULT '{}',
        "control_plane" boolean NOT NULL DEFAULT false,
        "witness" boolean NOT NULL DEFAULT false,
        "agent_version" varchar(64),
        "os" jsonb,
        "capabilities" jsonb,
        "capacity" jsonb,
        "usage" jsonb,
        "wireguard_public_key" varchar(64) NOT NULL,
        "endpoint_host" varchar(253),
        "overlay_v4" varchar(45),
        "overlay_v6" varchar(45),
        "pod_subnet_v4" varchar(64),
        "pod_subnet_v6" varchar(64),
        "certificate_fingerprints" jsonb NOT NULL DEFAULT '[]',
        "certificate_not_after" TIMESTAMPTZ,
        "applied_revision" integer NOT NULL DEFAULT 0,
        "apply_status" varchar(16),
        "apply_error" text,
        "last_seen_at" TIMESTAMPTZ,
        "joined_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_nodes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lw_nodes_name" UNIQUE ("name"),
        CONSTRAINT "CHK_lw_nodes_lifecycle" CHECK ("lifecycle" IN ('active', 'cordoned', 'draining', 'leaving', 'left'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_node_desired_states" (
        "node_name" varchar(63) NOT NULL,
        "revision" integer NOT NULL,
        "state" jsonb NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_node_desired_states" PRIMARY KEY ("node_name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_join_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "token_prefix" varchar(32) NOT NULL,
        "token_hash" varchar(64) NOT NULL,
        "description" varchar(255),
        "site" varchar(63) NOT NULL,
        "labels" jsonb NOT NULL DEFAULT '{}',
        "witness" boolean NOT NULL DEFAULT false,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "used_at" TIMESTAMPTZ,
        "used_by_node" varchar(63),
        "revoked_at" TIMESTAMPTZ,
        "created_by" varchar(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_join_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lw_join_tokens_prefix" UNIQUE ("token_prefix")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_audit_events" (
        "seq" bigint NOT NULL,
        "at" TIMESTAMPTZ NOT NULL,
        "actor_type" varchar(16) NOT NULL,
        "actor_id" varchar(255),
        "action" varchar(128) NOT NULL,
        "target" varchar(512) NOT NULL,
        "project" varchar(63),
        "details" jsonb NOT NULL DEFAULT '{}',
        "prev_hash" varchar(64) NOT NULL,
        "hash" varchar(64) NOT NULL,
        CONSTRAINT "PK_lw_audit_events" PRIMARY KEY ("seq")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_audit_events_at" ON "lw_audit_events" ("at")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lw_audit_events_project" ON "lw_audit_events" ("project", "at")`,
    );
    // Append-only (3.18): updates and deletes are rejected by the database itself.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "lw_audit_events_append_only"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'lw_audit_events is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_lw_audit_events_append_only" ON "lw_audit_events"`);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_lw_audit_events_append_only"
      BEFORE UPDATE OR DELETE OR TRUNCATE ON "lw_audit_events"
      FOR EACH STATEMENT EXECUTE FUNCTION "lw_audit_events_append_only"()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_cluster_members" (
        "user_id" uuid NOT NULL,
        "role" varchar(32) NOT NULL,
        "created_by" varchar(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lw_cluster_members" PRIMARY KEY ("user_id"),
        CONSTRAINT "FK_lw_cluster_members_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_lw_cluster_members_role" CHECK ("role" IN ('cluster-admin', 'infra-operator', 'auditor'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "changes" jsonb NOT NULL,
        "network_changes" jsonb NOT NULL DEFAULT '[]',
        "diagnostics" jsonb NOT NULL DEFAULT '[]',
        "created_by" varchar(255),
        "error" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_at" TIMESTAMPTZ,
        CONSTRAINT "PK_lw_plans" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lw_plans_created_at" ON "lw_plans" ("created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_plans"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_cluster_members"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TRG_lw_audit_events_append_only" ON "lw_audit_events"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "lw_audit_events_append_only"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_audit_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_join_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_node_desired_states"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_nodes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_resources"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_cluster"`);
  }
}
