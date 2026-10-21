import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recurring agent tasks (`agent_tasks`) and their runs (`agent_task_runs`), fired by the controller queue.
 */
export class CreateAgentTasks1792400000000 implements MigrationInterface {
  name = 'CreateAgentTasks1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "statistics_interaction_kind_enum" ADD VALUE IF NOT EXISTS 'agent_task_run'
    `);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_tasks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "client_id" uuid NOT NULL,
        "agent_id" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "prompt" text NOT NULL,
        "cron_expression" character varying(128) NOT NULL,
        "timezone" character varying(64) NOT NULL DEFAULT 'UTC',
        "model" character varying(256) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "next_run_at" TIMESTAMPTZ,
        "last_run_at" TIMESTAMPTZ,
        "last_run_status" character varying(16),
        "created_by_type" character varying(16) NOT NULL,
        "created_by_user_id" uuid,
        "updated_by_type" character varying(16) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agent_tasks_client" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_tasks_client_agent" ON "agent_tasks" ("client_id", "agent_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_tasks_due" ON "agent_tasks" ("enabled", "next_run_at")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_task_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "task_id" uuid NOT NULL,
        "client_id" uuid NOT NULL,
        "agent_id" uuid NOT NULL,
        "trigger" character varying(16) NOT NULL,
        "status" character varying(16) NOT NULL,
        "scheduled_for" TIMESTAMPTZ NOT NULL,
        "started_at" TIMESTAMPTZ NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "output_excerpt" text,
        "failure_message" character varying(512),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_task_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_task_runs_task_scheduled" UNIQUE ("task_id", "scheduled_for"),
        CONSTRAINT "FK_agent_task_runs_task" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_task_runs_client_agent_started" ON "agent_task_runs" ("client_id", "agent_id", "started_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_task_runs_status_started" ON "agent_task_runs" ("status", "started_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_task_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_tasks"`);
    // Postgres cannot remove enum values from statistics_interaction_kind_enum safely.
  }
}
