import {
  handleDynamicProviderError,
  loadProviderModule,
  parseProviderPackageSpec,
  readPluginPathFromEnv,
  type LoadProviderModuleOptions,
  type ProviderPackageEntry,
} from '@forepath/shared/backend/util-dynamic-provider-registry';
import { Logger } from '@nestjs/common';

import type { ContributorNestSource, RegisteredContributorNestModule } from './contributor-nest.types';
import {
  registerContributorNestModules,
  resolveContributorKeyFromPackage,
  resolveNestModuleExport,
} from './contributor-nest.types';

export const CONTRIBUTOR_NEST_ENV_REGISTRIES: ReadonlyArray<{
  envKey: string;
  source: ContributorNestSource;
}> = [
  { envKey: 'DYNAMIC_BILLING_PROVIDER_MODULES', source: 'provider' },
  { envKey: 'DYNAMIC_ADDON_MODULES', source: 'addon' },
  { envKey: 'DYNAMIC_INTEGRATED_STACK_MODULES', source: 'integrated' },
  { envKey: 'DYNAMIC_CLOUD_INIT_MODULES', source: 'cloud-init' },
];

export type ContributorNestModuleLoader = (
  entry: ProviderPackageEntry,
  options?: LoadProviderModuleOptions,
) => Promise<Record<string, unknown>>;

export interface LoadContributorNestModulesOptions {
  env?: NodeJS.ProcessEnv;
  loadModule?: ContributorNestModuleLoader;
  logger?: Logger;
}

/**
 * Loads optional `nestModule` exports from DYNAMIC_* contributor packages.
 * Packages that only export `createProvider` are skipped. Invalid nestModule,
 * missing keys, disallowed paths, and duplicates fail closed.
 */
export async function loadContributorNestModulesFromEnv(
  options: LoadContributorNestModulesOptions = {},
): Promise<RegisteredContributorNestModule[]> {
  const env = options.env ?? process.env;
  const loadModule = options.loadModule ?? loadProviderModule;
  const logger = options.logger ?? new Logger('ContributorNestLoader');
  const pluginPath = readPluginPathFromEnv(env);
  const collected: RegisteredContributorNestModule[] = [];

  for (const { envKey, source } of CONTRIBUTOR_NEST_ENV_REGISTRIES) {
    const entries = parseProviderPackageSpec(env[envKey]);

    for (const entry of entries) {
      let moduleExports: Record<string, unknown>;

      try {
        moduleExports = await loadModule(entry, { pluginPath, envKey });
      } catch (error) {
        handleDynamicProviderError(error, {
          criticality: 'optional',
          envKey,
          entryLabel: formatContributorEntryLabel(entry),
          onPermissive: (message) => logger.warn(message),
        });
        continue;
      }

      const nestModule = resolveNestModuleExport(moduleExports);

      if (!nestModule) {
        continue;
      }

      const sourceKey = resolveContributorKeyFromPackage(moduleExports, entry.alias);

      if (!sourceKey) {
        throw new Error('contributorKey export or env alias is required when nestModule is present');
      }

      collected.push({ source, sourceKey, nestModule });
    }
  }

  registerContributorNestModules(collected);

  return collected;
}

function formatContributorEntryLabel(entry: ProviderPackageEntry): string {
  if (entry.alias) {
    return `${entry.alias}=${entry.specifier}`;
  }

  if (entry.classExport) {
    return `${entry.classExport}=${entry.specifier}`;
  }

  return entry.specifier;
}
