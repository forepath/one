import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveTicketAutomationKnowledgeRelationSource1770700000000 implements MigrationInterface {
  name = 'RemoveTicketAutomationKnowledgeRelationSource1770700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Direct automation->knowledge relations are deprecated; automation resolves via ticket relations.
    await queryRunner.query(`
      DELETE FROM "knowledge_relations"
      WHERE "source_type" = 'ticketAutomation'
    `);

    await queryRunner.query(`
      CREATE TYPE "knowledge_relation_source_type_enum_new" AS ENUM ('ticket', 'page')
    `);

    await queryRunner.query(`
      ALTER TABLE "knowledge_relations"
      ALTER COLUMN "source_type"
      TYPE "knowledge_relation_source_type_enum_new"
      USING "source_type"::text::"knowledge_relation_source_type_enum_new"
    `);

    await queryRunner.query(`
      DROP TYPE "knowledge_relation_source_type_enum"
    `);

    await queryRunner.query(`
      ALTER TYPE "knowledge_relation_source_type_enum_new" RENAME TO "knowledge_relation_source_type_enum"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "knowledge_relation_source_type_enum_old" AS ENUM ('ticket', 'ticketAutomation', 'page')
    `);

    await queryRunner.query(`
      ALTER TABLE "knowledge_relations"
      ALTER COLUMN "source_type"
      TYPE "knowledge_relation_source_type_enum_old"
      USING "source_type"::text::"knowledge_relation_source_type_enum_old"
    `);

    await queryRunner.query(`
      DROP TYPE "knowledge_relation_source_type_enum"
    `);

    await queryRunner.query(`
      ALTER TYPE "knowledge_relation_source_type_enum_old" RENAME TO "knowledge_relation_source_type_enum"
    `);
  }
}
