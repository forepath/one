import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Task handoffs between agents of one workspace (`agent_handoffs`), driven by the controller queue.
 */
export class CreateAgentHandoffs1792600000000 implements MigrationInterface {
  name = 'CreateAgentHandoffs1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "statistics_interaction_kind_enum" ADD VALUE IF NOT EXISTS 'agent_handoff'
    `);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_handoffs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "client_id" uuid NOT NULL,
        "source_agent_id" uuid NOT NULL,
        "source_agent_name" character varying(255) NOT NULL,
        "source_chat_id" uuid NOT NULL,
        "source_model" character varying(256),
        "parent_handoff_id" uuid,
        "depth" integer NOT NULL DEFAULT 1,
        "target_agent_id" uuid NOT NULL,
        "target_agent_name" character varying(255) NOT NULL,
        "target_chat_id" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "message" text NOT NULL,
        "model" character varying(256),
        "status" character varying(16) NOT NULL,
        "response" text,
        "failure_message" character varying(512),
        "started_at" TIMESTAMPTZ,
        "finished_at" TIMESTAMPTZ,
        "delivered_at" TIMESTAMPTZ,
        "delivery_attempts" integer NOT NULL DEFAULT 0,
        "delivery_failure_message" character varying(512),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_handoffs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agent_handoffs_client" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_handoffs_client_status" ON "agent_handoffs" ("client_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_handoffs_target_chat" ON "agent_handoffs" ("target_agent_id", "target_chat_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_handoffs"`);
    // Postgres cannot remove enum values from statistics_interaction_kind_enum safely.
  }
}
