import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateRevokedUserTokensTable1775000000001 implements MigrationInterface {
  name = 'CreateRevokedUserTokensTable1775000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'revoked_user_tokens',
        columns: [
          {
            name: 'jti',
            type: 'varchar',
            length: '36',
            isPrimary: true,
            comment: 'JWT id claim for the revoked session token',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: false,
            comment: 'Original JWT expiry; row can be ignored after this time',
          },
          {
            name: 'revoked_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'revoked_user_tokens',
      new TableIndex({
        name: 'IDX_revoked_user_tokens_user_id',
        columnNames: ['user_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('revoked_user_tokens', 'IDX_revoked_user_tokens_user_id');
    await queryRunner.dropTable('revoked_user_tokens');
  }
}
