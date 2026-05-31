import type { DataSourceOptions } from 'typeorm';

import type { QueueRole } from './queue-role';
import { getQueueRole, shouldRunMigrations } from './queue-role';

/**
 * Omits migration definitions for worker/scheduler roles so TypeORM does not load migration files on startup.
 */
export function getTypeOrmOptionsForQueueRole(
  config: DataSourceOptions,
  role: QueueRole = getQueueRole(),
): DataSourceOptions {
  if (shouldRunMigrations(role)) {
    return config;
  }

  return {
    ...config,
    migrations: [],
  };
}
