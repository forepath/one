import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Workspace deployments: instance-wide CI/CD connections (`deployment_connections`, admin managed), workflows per
 * workspace (`deployment_workflows`) and their run history (`deployment_runs`). Workflow and run lifecycle events are
 * audited as statistics entity events.
 */
export class CreateDeployments1794200000000 implements MigrationInterface {
  name = 'CreateDeployments1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "statistics_entity_type_enum" ADD VALUE IF NOT EXISTS 'deployment_workflow'`);
    await queryRunner.query(`ALTER TYPE "statistics_entity_type_enum" ADD VALUE IF NOT EXISTS 'deployment_run'`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "deployment_connections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "label" character varying(200) NOT NULL,
        "provider" character varying(32) NOT NULL,
        "base_url" character varying(512),
        "auth_type" character varying(16) NOT NULL,
        "app_id" character varying(64),
        "installation_id" character varying(64),
        "username" character varying(320),
        "credentials" text NOT NULL,
        "workspace_access" character varying(16) NOT NULL DEFAULT 'all',
        "allowed_client_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "last_test_status" character varying(16) NOT NULL DEFAULT 'untested',
        "last_test_message" character varying(512),
        "last_tested_at" TIMESTAMPTZ,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_deployment_connections" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_deployment_connections_provider" CHECK ("provider" IN ('github', 'gitlab', 'jenkins')),
        CONSTRAINT "CHK_deployment_connections_auth_type" CHECK ("auth_type" IN ('app', 'token')),
        CONSTRAINT "CHK_deployment_connections_workspace_access" CHECK ("workspace_access" IN ('all', 'selected'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_deployment_connections_provider" ON "deployment_connections" ("provider")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "deployment_workflows" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "client_id" uuid NOT NULL,
        "connection_id" uuid NOT NULL,
        "name" character varying(200) NOT NULL,
        "description" text,
        "repository" character varying(512) NOT NULL,
        "workflow" character varying(512),
        "default_ref" character varying(255),
        "default_inputs" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "scope" character varying(16) NOT NULL DEFAULT 'global',
        "agent_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "agent_trigger_enabled" boolean NOT NULL DEFAULT false,
        "enabled" boolean NOT NULL DEFAULT true,
        "last_run_status" character varying(16),
        "last_run_conclusion" character varying(16),
        "last_run_at" TIMESTAMPTZ,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_deployment_workflows" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_deployment_workflows_scope" CHECK ("scope" IN ('global', 'environments')),
        CONSTRAINT "FK_deployment_workflows_client" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_deployment_workflows_connection" FOREIGN KEY ("connection_id") REFERENCES "deployment_connections"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_deployment_workflows_client" ON "deployment_workflows" ("client_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_deployment_workflows_connection" ON "deployment_workflows" ("connection_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "deployment_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "client_id" uuid NOT NULL,
        "workflow_id" uuid NOT NULL,
        "agent_id" uuid,
        "provider_run_id" character varying(255),
        "name" character varying(255),
        "status" character varying(16) NOT NULL,
        "conclusion" character varying(16),
        "ref" character varying(255),
        "sha" character varying(64),
        "url" text,
        "inputs" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "triggered_by_type" character varying(16) NOT NULL,
        "triggered_by_user_id" uuid,
        "started_at" TIMESTAMPTZ,
        "completed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_deployment_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_deployment_runs_workflow" FOREIGN KEY ("workflow_id") REFERENCES "deployment_workflows"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_deployment_runs_client_created" ON "deployment_runs" ("client_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_deployment_runs_workflow_created" ON "deployment_runs" ("workflow_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_deployment_runs_status" ON "deployment_runs" ("status")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_deployment_runs_workflow_provider_run" ON "deployment_runs" ("workflow_id", "provider_run_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "deployment_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "deployment_workflows"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "deployment_connections"`);
    // Postgres cannot remove enum values from statistics_entity_type_enum safely.
  }
}
