import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateUserPersonalAccessTokensTable1776100000000 implements MigrationInterface {
  name = 'CreateUserPersonalAccessTokensTable1776100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'user_personal_access_tokens',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'token_prefix',
            type: 'varchar',
            length: '32',
            isNullable: false,
          },
          {
            name: 'token_hash',
            type: 'varchar',
            length: '255',
            isNullable: false,
            comment: 'bcrypt hash of full plaintext token',
          },
          {
            name: 'scopes',
            type: 'jsonb',
            isNullable: false,
            default: "'[]'::jsonb",
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'revoked_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'last_used_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'user_personal_access_tokens',
      new TableIndex({
        name: 'IDX_user_personal_access_tokens_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'user_personal_access_tokens',
      new TableIndex({
        name: 'UQ_user_personal_access_tokens_token_prefix',
        columnNames: ['token_prefix'],
        isUnique: true,
      }),
    );

    await queryRunner.createForeignKey(
      'user_personal_access_tokens',
      new TableForeignKey({
        name: 'FK_user_personal_access_tokens_user_id',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('user_personal_access_tokens', 'FK_user_personal_access_tokens_user_id');
    await queryRunner.dropIndex('user_personal_access_tokens', 'UQ_user_personal_access_tokens_token_prefix');
    await queryRunner.dropIndex('user_personal_access_tokens', 'IDX_user_personal_access_tokens_user_id');
    await queryRunner.dropTable('user_personal_access_tokens');
  }
}
