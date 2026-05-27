import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add git_repository_setup_mode column to agents table.
 * Supports empty (git init) vs clone workspace initialization.
 */
export class AddGitRepositorySetupModeToAgentsTable1779800000000 implements MigrationInterface {
  name = 'AddGitRepositorySetupModeToAgentsTable1779800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'git_repository_setup_mode',
        type: 'varchar',
        length: '16',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('agents', 'git_repository_setup_mode');
  }
}
