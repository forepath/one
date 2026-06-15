import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKnowledgePageActivityTable1770800000000 implements MigrationInterface {
  name = 'CreateKnowledgePageActivityTable1770800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_actor_type_enum') THEN
          CREATE TYPE "knowledge_actor_type_enum" AS ENUM ('human', 'ai', 'system');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_page_activity" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "page_id" uuid NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "actor_type" "knowledge_actor_type_enum" NOT NULL,
        "actor_user_id" uuid NULL,
        "action_type" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL,
        CONSTRAINT "PK_knowledge_page_activity_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_knowledge_page_activity_page_id" FOREIGN KEY ("page_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_knowledge_page_activity_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_page_activity_page_occurred"
      ON "knowledge_page_activity" ("page_id", "occurred_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_page_activity_page_occurred"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_page_activity"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "knowledge_actor_type_enum"`);
  }
}
