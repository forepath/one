import { ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

const LOCK_KEY_PREFIX = 'project-bill-time:';

/**
 * Serialises bill-time per project with a session-level Postgres advisory lock. Lock and unlock run on one dedicated
 * connection: on pooled `dataSource.query` calls they could hit different sessions, leaving the lock held forever.
 */
export async function withProjectBillTimeLock<T>(
  dataSource: DataSource,
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (dataSource.options.type !== 'postgres') {
    return await fn();
  }

  const lockKey = `${LOCK_KEY_PREFIX}${projectId}`;
  const queryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();

  try {
    const tryLockRows: Array<{ acquired: boolean }> = await queryRunner.query(
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
      await queryRunner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]);
    }
  } finally {
    await queryRunner.release();
  }
}
