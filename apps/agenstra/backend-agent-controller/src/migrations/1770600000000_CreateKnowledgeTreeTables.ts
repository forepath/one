import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKnowledgeTreeTables1770600000000 implements MigrationInterface {
  name = 'CreateKnowledgeTreeTables1770600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_node_type_enum') THEN
          CREATE TYPE "knowledge_node_type_enum" AS ENUM ('folder', 'page');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_relation_source_type_enum') THEN
          CREATE TYPE "knowledge_relation_source_type_enum" AS ENUM ('ticket', 'ticketAutomation', 'page');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_relation_target_type_enum') THEN
          CREATE TYPE "knowledge_relation_target_type_enum" AS ENUM ('ticket', 'folder', 'page');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_nodes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL,
        "node_type" "knowledge_node_type_enum" NOT NULL,
        "parent_id" uuid NULL,
        "title" varchar(500) NOT NULL,
        "content" text NULL,
        "sort_order" int NOT NULL DEFAULT 0,
        "long_sha" varchar(40) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_nodes_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_knowledge_nodes_client_id" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_knowledge_nodes_parent_id" FOREIGN KEY ("parent_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_nodes_client_id" ON "knowledge_nodes" ("client_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_nodes_parent_id" ON "knowledge_nodes" ("parent_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_nodes_sort_order" ON "knowledge_nodes" ("client_id", "parent_id", "sort_order")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_nodes_long_sha" ON "knowledge_nodes" ("long_sha")
    `);

    await queryRunner.query(`
      UPDATE "knowledge_nodes"
      SET "long_sha" = encode(digest("id"::text, 'sha1'), 'hex')
      WHERE "long_sha" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_relations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL,
        "source_type" "knowledge_relation_source_type_enum" NOT NULL,
        "source_id" uuid NOT NULL,
        "target_type" "knowledge_relation_target_type_enum" NOT NULL,
        "target_node_id" uuid NULL,
        "target_ticket_long_sha" varchar(40) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_relations_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_knowledge_relations_client_id" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_knowledge_relations_target_node_id" FOREIGN KEY ("target_node_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_relations_source" ON "knowledge_relations" ("client_id", "source_type", "source_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_relations_target_node" ON "knowledge_relations" ("target_node_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_relations_target_ticket_sha" ON "knowledge_relations" ("target_ticket_long_sha")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_relations_target_ticket_sha"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_relations_target_node"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_relations_source"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_relations"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_nodes_long_sha"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_nodes_sort_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_nodes_parent_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_nodes_client_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_nodes"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "knowledge_relation_target_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "knowledge_relation_source_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "knowledge_node_type_enum"`);
  }
}
