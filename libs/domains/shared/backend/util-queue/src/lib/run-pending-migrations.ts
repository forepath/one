import { Logger } from '@nestjs/common';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import type { DataSourceOptions } from 'typeorm';
import { DataSource } from 'typeorm';

import type { QueueRole } from './queue-role';
import { shouldRunMigrations } from './queue-role';

/**
 * Runs pending TypeORM migrations only when QUEUE_ROLE is `api` or `all`.
 */
export async function runPendingMigrationsIfRoleAllows(
  app: INestApplication | INestApplicationContext,
  role: QueueRole,
  config: DataSourceOptions,
): Promise<void> {
  if (!shouldRunMigrations(role)) {
    Logger.log(`Skipping database migrations (QUEUE_ROLE=${role})`, 'Migrations');

    return;
  }

  if (config.synchronize) {
    Logger.log('Schema synchronization enabled — migrations skipped', 'Migrations');

    return;
  }

  if (!config.migrations?.length) {
    return;
  }

  const dataSource = app.get(DataSource);

  try {
    Logger.log('Running pending migrations...', 'Migrations');
    await dataSource.runMigrations();
    Logger.log('Migrations completed successfully', 'Migrations');
  } catch (error) {
    Logger.error('Failed to run migrations', error, 'Migrations');
    throw error;
  }
}
