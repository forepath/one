import { ConflictException } from '@nestjs/common';

import { withProjectBillTimeLock } from './project-bill-time-lock.util';

function postgresDataSource(queryResults: unknown[]) {
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
  };

  for (const result of queryResults) {
    queryRunner.query.mockResolvedValueOnce(result);
  }

  return {
    dataSource: { options: { type: 'postgres' }, query: jest.fn(), createQueryRunner: jest.fn(() => queryRunner) },
    queryRunner,
  };
}

describe('withProjectBillTimeLock', () => {
  it('runs fn directly when driver is not postgres', async () => {
    const dataSource = { options: { type: 'sqlite' }, query: jest.fn(), createQueryRunner: jest.fn() };
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(withProjectBillTimeLock(dataSource as never, 'p1', fn)).resolves.toBe('ok');
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalled();
  });

  it('acquires and releases the advisory lock on the same dedicated connection', async () => {
    const { dataSource, queryRunner } = postgresDataSource([[{ acquired: true }], []]);
    const fn = jest.fn().mockResolvedValue('done');

    await expect(withProjectBillTimeLock(dataSource as never, 'p1', fn)).resolves.toBe('done');
    expect(queryRunner.query).toHaveBeenNthCalledWith(1, `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`, [
      'project-bill-time:p1',
    ]);
    expect(queryRunner.query).toHaveBeenNthCalledWith(2, `SELECT pg_advisory_unlock(hashtext($1))`, [
      'project-bill-time:p1',
    ]);
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('throws when postgres advisory lock is not acquired and releases the connection', async () => {
    const { dataSource, queryRunner } = postgresDataSource([[{ acquired: false }]]);
    const fn = jest.fn();

    await expect(withProjectBillTimeLock(dataSource as never, 'p1', fn)).rejects.toThrow(ConflictException);
    expect(fn).not.toHaveBeenCalled();
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('releases lock and connection when fn throws', async () => {
    const { dataSource, queryRunner } = postgresDataSource([[{ acquired: true }], []]);
    const fn = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(withProjectBillTimeLock(dataSource as never, 'p1', fn)).rejects.toThrow('boom');
    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
