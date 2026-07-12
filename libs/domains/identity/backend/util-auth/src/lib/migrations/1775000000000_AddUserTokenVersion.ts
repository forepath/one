import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddUserTokenVersion1775000000000 implements MigrationInterface {
  name = 'AddUserTokenVersion1775000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'token_version',
        type: 'int',
        isNullable: false,
        default: 0,
        comment: 'Incremented on logout and credential changes to invalidate existing JWTs',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'token_version');
  }
}
