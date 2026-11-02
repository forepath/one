import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSearchPreferences1800000000024 implements MigrationInterface {
  name = 'CreateSearchPreferences1800000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Global search (3.25): favourites and recently visited items come first, per user.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_search_favorites" (
        "user_id" varchar(255) NOT NULL,
        "item" varchar(512) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY ("user_id", "item")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lw_search_recents" (
        "user_id" varchar(255) NOT NULL,
        "item" varchar(512) NOT NULL,
        "visited_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY ("user_id", "item")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_search_recents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lw_search_favorites"`);
  }
}
