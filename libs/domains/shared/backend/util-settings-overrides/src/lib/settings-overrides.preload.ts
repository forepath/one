import { DataSource, DataSourceOptions, EntityTarget, ObjectLiteral } from 'typeorm';

import { SettingDefinition, SettingsOverrideRecord } from './setting-definition.types';
import {
  installSettingsOverridesEnv,
  registerSettingDefinitions,
  replaceSettingsOverrides,
} from './settings-overrides.registry';

export interface SettingsOverridesPreloadLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface PreloadSettingsOverridesOptions<T extends ObjectLiteral> {
  dataSourceOptions: DataSourceOptions;
  entity: EntityTarget<T>;
  definitions: readonly SettingDefinition[];
  toRecord: (row: T) => SettingsOverrideRecord;
  logger?: SettingsOverridesPreloadLogger;
}

/**
 * Registers the catalog, installs the `process.env` overlay and loads the stored overrides **before** the Nest
 * application is created, so settings read at startup (scheduler intervals, constructor-time reads) see them.
 * A missing table (first start before migrations) or an unreachable database leaves only the environment in
 * effect; the in-app service loads again once the application is up.
 */
export async function preloadSettingsOverrides<T extends ObjectLiteral>(
  options: PreloadSettingsOverridesOptions<T>,
): Promise<number> {
  registerSettingDefinitions(options.definitions);
  installSettingsOverridesEnv();

  const dataSource = new DataSource({
    ...options.dataSourceOptions,
    entities: [options.entity as never],
    migrations: [],
    migrationsRun: false,
    synchronize: false,
    logging: false,
  } as DataSourceOptions);

  try {
    await dataSource.initialize();

    const rows = await dataSource.getRepository(options.entity).find();

    replaceSettingsOverrides(rows.map(options.toRecord));
    options.logger?.log(`Loaded ${rows.length} settings override(s)`);

    return rows.length;
  } catch (error) {
    options.logger?.warn(
      `Settings overrides not loaded before startup (${(error as Error).message}); environment values apply until the application loads them`,
    );

    return 0;
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}
