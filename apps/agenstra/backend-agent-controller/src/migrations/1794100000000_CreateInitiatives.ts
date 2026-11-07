import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initiatives (workspace planning that follows the BMad Method): initiatives with their documents (+ versions), work
 * items (+ dependencies, unknowns), step runs (+ turns), change proposals, decisions, findings and activity.
 * Everything cascades with the initiative (and the workspace); linked tickets are kept (`ticket_id` SET NULL).
 * Purely additive: no existing table or enum changes.
 */
export class CreateInitiatives1794100000000 implements MigrationInterface {
  name = 'CreateInitiatives1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Usage statistics of step-run turns (hidden `-initiative-{id}` sessions).
    await queryRunner.query(
      `ALTER TYPE "statistics_interaction_kind_enum" ADD VALUE IF NOT EXISTS 'initiative_run_turn'`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiatives" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "client_id" uuid NOT NULL,
        "title" varchar(500) NOT NULL,
        "intent" text NOT NULL DEFAULT '',
        "path" varchar(16) NOT NULL,
        "phase" varchar(16) NOT NULL,
        "state" varchar(16) NOT NULL,
        "iteration" integer NOT NULL DEFAULT 1,
        "default_agent_id" uuid NULL,
        "default_model" varchar(256) NULL,
        "prerequisite_satisfied_at" varchar(8) NOT NULL DEFAULT 'done',
        "auto_release" boolean NOT NULL DEFAULT false,
        "version" integer NOT NULL DEFAULT 1,
        "long_sha" varchar(40) NULL,
        "created_by_user_id" uuid NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_initiatives_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiatives_client_id" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiatives_client_updated" ON "initiatives" ("client_id", "updated_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiatives_client_long_sha" ON "initiatives" ("client_id", "long_sha")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_work_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "initiative_id" uuid NOT NULL,
        "client_id" uuid NOT NULL,
        "parent_id" uuid NULL,
        "kind" varchar(8) NOT NULL,
        "key" varchar(16) NOT NULL,
        "title" varchar(500) NOT NULL,
        "requirements" text NOT NULL DEFAULT '',
        "verify" text NOT NULL DEFAULT '',
        "done_when" text NOT NULL DEFAULT '',
        "refined" boolean NOT NULL DEFAULT false,
        "plan_checkpoint" boolean NOT NULL DEFAULT false,
        "done_checkpoint" boolean NOT NULL DEFAULT false,
        "priority" varchar(16) NOT NULL DEFAULT 'medium',
        "sort_order" integer NOT NULL DEFAULT 0,
        "status" varchar(16) NOT NULL DEFAULT 'draft',
        "ticket_id" uuid NULL,
        "retrospective_verdict" varchar(32) NULL,
        "retrospective_overridden" boolean NOT NULL DEFAULT false,
        "automation_blocked" boolean NOT NULL DEFAULT false,
        "iteration_created" integer NOT NULL DEFAULT 1,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_initiative_work_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiative_work_items_initiative_id" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_initiative_work_items_parent_id" FOREIGN KEY ("parent_id") REFERENCES "initiative_work_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_initiative_work_items_ticket_id" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_initiative_work_items_initiative_key" ON "initiative_work_items" ("initiative_id", "key")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_work_items_initiative_order" ON "initiative_work_items" ("initiative_id", "sort_order")`,
    );
    // One work item per ticket; also the lookup of ticket automation's prerequisite predicate.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_initiative_work_items_ticket" ON "initiative_work_items" ("ticket_id") WHERE "ticket_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_work_item_dependencies" (
        "work_item_id" uuid NOT NULL,
        "prerequisite_id" uuid NOT NULL,
        "initiative_id" uuid NOT NULL,
        CONSTRAINT "PK_initiative_work_item_dependencies" PRIMARY KEY ("work_item_id", "prerequisite_id"),
        CONSTRAINT "FK_initiative_work_item_dependencies_work_item_id" FOREIGN KEY ("work_item_id") REFERENCES "initiative_work_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_initiative_work_item_dependencies_prerequisite_id" FOREIGN KEY ("prerequisite_id") REFERENCES "initiative_work_items"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_initiative_work_item_dependencies_not_self" CHECK ("work_item_id" <> "prerequisite_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_work_item_dependencies_initiative" ON "initiative_work_item_dependencies" ("initiative_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_work_item_dependencies_prerequisite" ON "initiative_work_item_dependencies" ("prerequisite_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_artifacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "initiative_id" uuid NOT NULL,
        "client_id" uuid NOT NULL,
        "type" varchar(32) NOT NULL,
        "work_item_id" uuid NULL,
        "title" varchar(500) NOT NULL,
        "content" text NOT NULL DEFAULT '',
        "current_version" integer NOT NULL DEFAULT 1,
        "accepted_version" integer NULL,
        "accepted_at" TIMESTAMPTZ NULL,
        "accepted_by_user_id" uuid NULL,
        "published_node_id" uuid NULL,
        "version" integer NOT NULL DEFAULT 1,
        "long_sha" varchar(40) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_initiative_artifacts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiative_artifacts_initiative_id" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_initiative_artifacts_work_item_id" FOREIGN KEY ("work_item_id") REFERENCES "initiative_work_items"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_artifacts_initiative" ON "initiative_artifacts" ("initiative_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_artifacts_client_long_sha" ON "initiative_artifacts" ("client_id", "long_sha")`,
    );
    // One document per type (per epic for epic documents); notes are free.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_initiative_artifacts_type" ON "initiative_artifacts" ("initiative_id", "type") WHERE "work_item_id" IS NULL AND "type" <> 'note'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_initiative_artifacts_epic_type" ON "initiative_artifacts" ("work_item_id", "type") WHERE "work_item_id" IS NOT NULL AND "type" <> 'note'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_artifact_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "artifact_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "content" text NOT NULL,
        "iteration" integer NOT NULL,
        "source" varchar(16) NOT NULL,
        "run_id" uuid NULL,
        "proposal_id" uuid NULL,
        "created_by_user_id" uuid NULL,
        "agent_id" uuid NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_initiative_artifact_versions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiative_artifact_versions_artifact_id" FOREIGN KEY ("artifact_id") REFERENCES "initiative_artifacts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_initiative_artifact_versions_artifact_version" ON "initiative_artifact_versions" ("artifact_id", "version")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_unknowns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "initiative_id" uuid NOT NULL,
        "work_item_id" uuid NULL,
        "question" text NOT NULL,
        "resolution" varchar(16) NOT NULL,
        "answer" text NULL,
        "resolved_at" TIMESTAMPTZ NULL,
        "resolved_by_user_id" uuid NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_initiative_unknowns_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiative_unknowns_initiative_id" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_initiative_unknowns_work_item_id" FOREIGN KEY ("work_item_id") REFERENCES "initiative_work_items"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_unknowns_initiative" ON "initiative_unknowns" ("initiative_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "initiative_id" uuid NOT NULL,
        "client_id" uuid NOT NULL,
        "step" varchar(32) NOT NULL,
        "mode" varchar(16) NOT NULL,
        "style" varchar(16) NOT NULL,
        "target_work_item_id" uuid NULL,
        "target_artifact_id" uuid NULL,
        "agent_id" uuid NOT NULL,
        "model" varchar(256) NULL,
        "status" varchar(16) NOT NULL,
        "resume_session_suffix" varchar(128) NOT NULL,
        "result" jsonb NULL,
        "base_versions" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "finding_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "streaming_text" text NULL,
        "failure_code" varchar(64) NULL,
        "failure_message" varchar(512) NULL,
        "created_by_user_id" uuid NULL,
        "decided_by_user_id" uuid NULL,
        "finished_at" TIMESTAMPTZ NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_initiative_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiative_runs_initiative_id" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_runs_initiative_created" ON "initiative_runs" ("initiative_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_runs_client_status" ON "initiative_runs" ("client_id", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_run_turns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "run_id" uuid NOT NULL,
        "seq" integer NOT NULL,
        "role" varchar(8) NOT NULL,
        "content" text NOT NULL,
        "actor_user_id" uuid NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_initiative_run_turns_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiative_run_turns_run_id" FOREIGN KEY ("run_id") REFERENCES "initiative_runs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_initiative_run_turns_run_seq" ON "initiative_run_turns" ("run_id", "seq")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_change_proposals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "initiative_id" uuid NOT NULL,
        "origin" varchar(16) NOT NULL,
        "title" varchar(500) NOT NULL,
        "rationale" text NOT NULL DEFAULT '',
        "changes" jsonb NOT NULL,
        "base_versions" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar(16) NOT NULL,
        "bumps_iteration" boolean NOT NULL DEFAULT true,
        "run_id" uuid NULL,
        "agent_id" uuid NULL,
        "created_by_user_id" uuid NULL,
        "decided_by_user_id" uuid NULL,
        "decided_at" TIMESTAMPTZ NULL,
        "decision_note" text NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_initiative_change_proposals_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiative_change_proposals_initiative_id" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_change_proposals_initiative_status" ON "initiative_change_proposals" ("initiative_id", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_decisions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "initiative_id" uuid NOT NULL,
        "work_item_id" uuid NULL,
        "title" varchar(500) NOT NULL,
        "body" text NOT NULL DEFAULT '',
        "status" varchar(16) NOT NULL,
        "iteration" integer NOT NULL,
        "proposal_id" uuid NULL,
        "run_id" uuid NULL,
        "agent_id" uuid NULL,
        "created_by_user_id" uuid NULL,
        "decided_by_user_id" uuid NULL,
        "decided_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_initiative_decisions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiative_decisions_initiative_id" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_decisions_initiative_created" ON "initiative_decisions" ("initiative_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_findings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "initiative_id" uuid NOT NULL,
        "work_item_id" uuid NULL,
        "source" varchar(16) NOT NULL,
        "severity" varchar(8) NOT NULL,
        "body" text NOT NULL,
        "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" varchar(16) NOT NULL,
        "proposal_id" uuid NULL,
        "run_id" uuid NULL,
        "agent_id" uuid NULL,
        "created_by_user_id" uuid NULL,
        "resolved_by_user_id" uuid NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_initiative_findings_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiative_findings_initiative_id" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_findings_initiative_status" ON "initiative_findings" ("initiative_id", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "initiative_activity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "initiative_id" uuid NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "actor_type" varchar(16) NOT NULL,
        "actor_user_id" uuid NULL,
        "agent_id" uuid NULL,
        "action_type" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "PK_initiative_activity_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_initiative_activity_initiative_id" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_initiative_activity_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_initiative_activity_initiative_occurred" ON "initiative_activity" ("initiative_id", "occurred_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_activity"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_findings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_decisions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_change_proposals"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_run_turns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_unknowns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_artifact_versions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_artifacts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_work_item_dependencies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiative_work_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "initiatives"`);
  }
}
