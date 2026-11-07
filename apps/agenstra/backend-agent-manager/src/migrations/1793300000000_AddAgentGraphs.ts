import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentGraphs1793300000000 implements MigrationInterface {
  name = 'AddAgentGraphs1793300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_graphs" (
        "agent_id" uuid PRIMARY KEY REFERENCES "agents"("id") ON DELETE CASCADE,
        "status" varchar(16) NOT NULL DEFAULT 'missing',
        "built_at" timestamptz NULL,
        "build_duration_ms" integer NULL,
        "truncated" boolean NOT NULL DEFAULT false,
        "error" text NULL,
        "file_count" integer NOT NULL DEFAULT 0,
        "languages" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "layer_stats" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "listing" jsonb NULL,
        "parsed" jsonb NULL,
        "instruction_files" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "referenced_mount_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "implicit_context" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "agent_graph_prompts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
        "correlation_id" varchar(128) NOT NULL,
        "chat_session_id" uuid NULL,
        "message_id" uuid NULL,
        "origin" varchar(16) NOT NULL,
        "excerpt" text NULL,
        "started_at" timestamptz NOT NULL,
        "finished_at" timestamptz NULL,
        "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_graph_prompts_agent_started" ON "agent_graph_prompts" ("agent_id", "started_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_agent_graph_prompts_agent_correlation" ON "agent_graph_prompts" ("agent_id", "correlation_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "agent_graph_prompts"');
    await queryRunner.query('DROP TABLE "agent_graphs"');
  }
}
