import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Drops the agent container type: it only labeled environments (generic, docker, terraform, kubernetes) and fed a
 * "repository type" hint into prompt enrichment, without changing any provisioning or tooling.
 */
export class DropAgentContainerType1793200000000 implements MigrationInterface {
  name = 'DropAgentContainerType1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "agents" DROP COLUMN IF EXISTS "container_type"');
    await queryRunner.query('DROP TYPE IF EXISTS "agents_container_type_enum"');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'container_type',
        type: 'varchar',
        length: '50',
        default: "'generic'",
        isNullable: false,
      }),
    );
  }
}
