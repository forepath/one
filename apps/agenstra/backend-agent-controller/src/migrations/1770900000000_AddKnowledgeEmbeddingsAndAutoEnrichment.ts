import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKnowledgeEmbeddingsAndAutoEnrichment1770900000000 implements MigrationInterface {
  name = 'AddKnowledgeEmbeddingsAndAutoEnrichment1770900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_node_embeddings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL,
        "knowledge_node_id" uuid NOT NULL,
        "chunk_index" int NOT NULL,
        "chunk_text" text NOT NULL,
        "embedding" vector(768) NOT NULL,
        "embedding_model" varchar(128) NOT NULL,
        "embedding_provider" varchar(64) NOT NULL,
        "content_hash" varchar(64) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_node_embeddings_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_knowledge_node_embeddings_client_id" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_knowledge_node_embeddings_node_id" FOREIGN KEY ("knowledge_node_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_knowledge_node_embeddings_client_node_chunk" UNIQUE ("client_id", "knowledge_node_id", "chunk_index")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_node_embeddings_client_id"
      ON "knowledge_node_embeddings" ("client_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_node_embeddings_node_id"
      ON "knowledge_node_embeddings" ("knowledge_node_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_node_embeddings_content_hash"
      ON "knowledge_node_embeddings" ("content_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_node_embeddings_embedding_ivfflat"
      ON "knowledge_node_embeddings" USING ivfflat ("embedding" vector_cosine_ops)
      WITH (lists = 100)
    `);

    await queryRunner.query(`
      ALTER TABLE "ticket_automation"
      ADD COLUMN IF NOT EXISTS "auto_enrichment_enabled" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ticket_automation" DROP COLUMN IF EXISTS "auto_enrichment_enabled"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_node_embeddings_embedding_ivfflat"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_node_embeddings_content_hash"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_node_embeddings_node_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_node_embeddings_client_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_node_embeddings"`);
  }
}
