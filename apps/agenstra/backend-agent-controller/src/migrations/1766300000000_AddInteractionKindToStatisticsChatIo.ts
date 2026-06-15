import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds interaction_kind to statistics_chat_io to distinguish normal chat from prompt enhancement metrics.
 */
export class AddInteractionKindToStatisticsChatIo1766300000000 implements MigrationInterface {
  name = 'AddInteractionKindToStatisticsChatIo1766300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "statistics_interaction_kind_enum" AS ENUM ('chat', 'prompt_enhancement');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "statistics_chat_io"
      ADD COLUMN "interaction_kind" "statistics_interaction_kind_enum" NOT NULL DEFAULT 'chat'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "statistics_chat_io" DROP COLUMN "interaction_kind"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "statistics_interaction_kind_enum"`);
  }
}
