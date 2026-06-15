import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add git_repository_url column to agents table.
 * This migration adds support for associating a Git repository URL with an agent.
 * The column is nullable to allow existing agents without a repository URL.
 */
export class AddGitRepositoryUrlToAgentsTable1766221532960 implements MigrationInterface {
  name = 'AddGitRepositoryUrlToAgentsTable1766221532960';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add git_repository_url column
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'git_repository_url',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove git_repository_url column
    await queryRunner.dropColumn('agents', 'git_repository_url');
  }
}
