import { ConflictException } from '@nestjs/common';

import { withProjectBillTimeLock } from './project-bill-time-lock.util';

describe('withProjectBillTimeLock', () => {
  it('runs fn directly when driver is not postgres', async () => {
    const dataSource = { options: { type: 'sqlite' }, query: jest.fn() };
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(withProjectBillTimeLock(dataSource as never, 'p1', fn)).resolves.toBe('ok');
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalled();
  });

  it('acquires and releases postgres advisory lock', async () => {
    const dataSource = {
      options: { type: 'postgres' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([]),
    };
    const fn = jest.fn().mockResolvedValue('done');

    await expect(withProjectBillTimeLock(dataSource as never, 'p1', fn)).resolves.toBe('done');
    expect(dataSource.query).toHaveBeenNthCalledWith(1, `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`, [
      'project-bill-time:p1',
    ]);
    expect(dataSource.query).toHaveBeenNthCalledWith(2, `SELECT pg_advisory_unlock(hashtext($1))`, [
      'project-bill-time:p1',
    ]);
  });

  it('throws when postgres advisory lock is not acquired', async () => {
    const dataSource = {
      options: { type: 'postgres' },
      query: jest.fn().mockResolvedValueOnce([{ acquired: false }]),
    };
    const fn = jest.fn();

    await expect(withProjectBillTimeLock(dataSource as never, 'p1', fn)).rejects.toThrow(ConflictException);
    expect(fn).not.toHaveBeenCalled();
  });

  it('releases lock when fn throws', async () => {
    const dataSource = {
      options: { type: 'postgres' },
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([]),
    };
    const fn = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(withProjectBillTimeLock(dataSource as never, 'p1', fn)).rejects.toThrow('boom');
    expect(dataSource.query).toHaveBeenCalledTimes(2);
  });
});
