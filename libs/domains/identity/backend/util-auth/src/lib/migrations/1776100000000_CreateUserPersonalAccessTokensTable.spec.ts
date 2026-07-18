import { QueryRunner } from 'typeorm';

import { CreateUserPersonalAccessTokensTable1776100000000 } from './1776100000000_CreateUserPersonalAccessTokensTable';

describe('CreateUserPersonalAccessTokensTable1776100000000', () => {
  const migration = new CreateUserPersonalAccessTokensTable1776100000000();

  it('creates the PAT table, indexes, and foreign key on up', async () => {
    const queryRunner = {
      createTable: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue(undefined),
      createForeignKey: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner;

    await migration.up(queryRunner);

    expect(queryRunner.createTable).toHaveBeenCalledTimes(1);
    expect(queryRunner.createIndex).toHaveBeenCalledTimes(2);
    expect(queryRunner.createForeignKey).toHaveBeenCalledTimes(1);
  });

  it('drops foreign key, indexes, and table on down', async () => {
    const queryRunner = {
      dropForeignKey: jest.fn().mockResolvedValue(undefined),
      dropIndex: jest.fn().mockResolvedValue(undefined),
      dropTable: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner;

    await migration.down(queryRunner);

    expect(queryRunner.dropForeignKey).toHaveBeenCalledWith(
      'user_personal_access_tokens',
      'FK_user_personal_access_tokens_user_id',
    );
    expect(queryRunner.dropIndex).toHaveBeenCalledTimes(2);
    expect(queryRunner.dropTable).toHaveBeenCalledWith('user_personal_access_tokens');
  });
});
