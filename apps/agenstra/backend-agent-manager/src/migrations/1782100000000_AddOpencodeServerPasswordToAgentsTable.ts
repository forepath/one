import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Store GCM-encrypted OpenCode HTTP Basic-auth passwords for worker `opencode serve`.
 */
export class AddOpencodeServerPasswordToAgentsTable1782100000000 implements MigrationInterface {
  name = 'AddOpencodeServerPasswordToAgentsTable1782100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'opencode_server_password',
        type: 'varchar',
        length: '1024',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('agents', 'opencode_server_password');
  }
}
