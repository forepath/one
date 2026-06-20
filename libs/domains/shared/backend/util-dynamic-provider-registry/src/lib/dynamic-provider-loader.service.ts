import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { readPluginPathFromEnv } from './install-provider-plugins';
import { loadProviderModule } from './load-provider-module';
import { parseProviderPackageSpec } from './parse-provider-package-spec';
import { resolveProviderLoadTarget } from './resolve-provider-load-target';
import { instantiateResolvedProvider, resolveProviderExport, resolveProviderMetadata } from './resolve-provider-export';
import { handleDynamicProviderError } from './startup-error-policy';
import type {
  LoadProviderModuleOptions,
  ProviderMetadataRecord,
  ProviderPackageEntry,
  RegistryCriticality,
} from './types';

export interface DynamicProviderLoaderOptions {
  appRoot?: string;
  pluginPath?: string;
  allowTestFixtureExports?: boolean;
}

@Injectable()
export class DynamicProviderLoaderService {
  private readonly logger = new Logger(DynamicProviderLoaderService.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  async loadInstances<T>(
    envKey: string,
    criticality: RegistryCriticality,
    options: DynamicProviderLoaderOptions & { failFast?: boolean } = {},
  ): Promise<T[]> {
    const entries = parseProviderPackageSpec(process.env[envKey]);
    const instances: T[] = [];
    const loaderOptions = this.buildLoaderOptions(options);

    for (const entry of entries) {
      try {
        const instance = await this.loadInstance<T>(entry, envKey, loaderOptions);

        instances.push(instance);
      } catch (error) {
        handleDynamicProviderError(error, {
          criticality,
          failFast: options.failFast,
          envKey,
          entryLabel: formatEntryLabel(entry),
          onPermissive: (message, permissiveError) => {
            this.logger.error(message, permissiveError instanceof Error ? permissiveError.stack : undefined);
          },
        });
      }
    }

    return instances;
  }

  async loadMetadata(
    envKey: string,
    criticality: RegistryCriticality,
    options: DynamicProviderLoaderOptions & { failFast?: boolean } = {},
  ): Promise<ProviderMetadataRecord[]> {
    const entries = parseProviderPackageSpec(process.env[envKey]);
    const metadataRecords: ProviderMetadataRecord[] = [];
    const loaderOptions = this.buildLoaderOptions(options);

    for (const entry of entries) {
      try {
        const targetOptions = { ...loaderOptions, envKey };
        const loadTarget = resolveProviderLoadTarget(entry, targetOptions);
        const module = await loadProviderModule(entry, targetOptions);
        const metadata = resolveProviderMetadata(module);

        if (!metadata) {
          throw new Error(`Provider package '${loadTarget.specifier}' does not export providerMetadata`);
        }

        metadataRecords.push(metadata);
      } catch (error) {
        handleDynamicProviderError(error, {
          criticality,
          failFast: options.failFast,
          envKey,
          entryLabel: formatEntryLabel(entry),
          onPermissive: (message, permissiveError) => {
            this.logger.error(message, permissiveError instanceof Error ? permissiveError.stack : undefined);
          },
        });
      }
    }

    return metadataRecords;
  }

  private async loadInstance<T>(
    entry: ProviderPackageEntry,
    envKey: string,
    options: DynamicProviderLoaderOptions,
  ): Promise<T> {
    const targetOptions: LoadProviderModuleOptions = { ...options, envKey };
    const loadTarget = resolveProviderLoadTarget(entry, targetOptions);
    const module = await loadProviderModule(entry, targetOptions);
    const resolved = resolveProviderExport<T>(module, {
      entry,
      loadTarget,
      allowTestFixtureExports: options.allowTestFixtureExports,
    });

    return await instantiateResolvedProvider(resolved, this.moduleRef);
  }

  private buildLoaderOptions(options: DynamicProviderLoaderOptions): DynamicProviderLoaderOptions {
    return {
      appRoot: options.appRoot,
      pluginPath: options.pluginPath ?? readPluginPathFromEnv(),
      allowTestFixtureExports: options.allowTestFixtureExports,
    };
  }
}

function formatEntryLabel(entry: ProviderPackageEntry): string {
  if (entry.alias) {
    return `${entry.alias}=${entry.specifier}`;
  }

  if (entry.classExport) {
    return `${entry.classExport}=${entry.specifier}`;
  }

  return entry.specifier;
}
