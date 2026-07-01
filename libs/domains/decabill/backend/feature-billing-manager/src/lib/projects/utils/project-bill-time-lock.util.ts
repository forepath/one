import { ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

const LOCK_KEY_PREFIX = 'project-bill-time:';

export async function withProjectBillTimeLock<T>(
  dataSource: DataSource,
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (dataSource.options.type !== 'postgres') {
    return await fn();
  }

  const lockKey = `${LOCK_KEY_PREFIX}${projectId}`;
  const tryLockRows: Array<{ acquired: boolean }> = await dataSource.query(
    `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
    [lockKey],
  );
  const acquired = Boolean(tryLockRows[0]?.acquired);

  if (!acquired) {
    throw new ConflictException('Another bill-time operation is in progress for this project');
  }

  try {
    return await fn();
  } finally {
    await dataSource.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]);
  }
}
