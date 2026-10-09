import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentDirectoryIndex1791531900000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_directory_index" (
        "id" varchar(64) PRIMARY KEY,
        "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
        "container_id" text NOT NULL,
        "directory_path" text NOT NULL,
        "nodes" jsonb NOT NULL,
        "refreshed_at" timestamptz NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_directory_index_agent_id" ON "agent_directory_index" ("agent_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_directory_index_refreshed_at" ON "agent_directory_index" ("refreshed_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "agent_directory_index"');
  }
}
