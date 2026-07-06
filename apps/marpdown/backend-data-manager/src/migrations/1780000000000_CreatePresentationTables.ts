import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Presentation markdown and asset payloads are encrypted at the application layer
 * using AES-256-GCM (see createAes256GcmTransformer). Columns are plain text in Postgres.
 */
export class CreatePresentationTables1780000000000 implements MigrationInterface {
  name = 'CreatePresentationTables1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS presentations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title varchar(500) NOT NULL,
        markdown text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_presentations_user_updated
      ON presentations (user_id, updated_at DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS presentation_assets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        presentation_id uuid NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
        path varchar(1024) NOT NULL,
        content text NOT NULL,
        mime_type varchar(255) NOT NULL,
        size_bytes integer NOT NULL,
        is_directory boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_presentation_assets_presentation_path UNIQUE (presentation_id, path)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_presentation_assets_presentation_path
      ON presentation_assets (presentation_id, path)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS presentation_assets');
    await queryRunner.query('DROP TABLE IF EXISTS presentations');
  }
}
