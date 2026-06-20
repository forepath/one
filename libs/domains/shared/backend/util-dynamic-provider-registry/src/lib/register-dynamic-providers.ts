import { Logger } from '@nestjs/common';

import type { DynamicProviderLoaderService } from './dynamic-provider-loader.service';
import type { DynamicProviderMetadataRegistrationOptions, DynamicProviderRegistrationOptions } from './types';

const defaultLogger = new Logger('DynamicProviderRegistry');

/**
 * Loads and registers dynamic provider instances from a DYNAMIC_* env var.
 * Static registrations in the host module should run before calling this helper.
 */
export async function registerDynamicProviders<T>(options: DynamicProviderRegistrationOptions<T>): Promise<void> {
  const logger = options.loggerContext ? new Logger(options.loggerContext) : defaultLogger;
  const instances = await options.dynamicLoader.loadInstances(options.envKey, options.criticality, {
    failFast: options.failFast,
  });

  for (const instance of instances) {
    options.register(instance);
    logger.log(`Registered dynamic provider from ${options.envKey}`);
  }
}

/**
 * Loads providerMetadata exports from dynamic packages and registers billing UI metadata.
 */
export async function registerDynamicProviderMetadata(
  options: DynamicProviderMetadataRegistrationOptions,
): Promise<void> {
  const logger = options.loggerContext ? new Logger(options.loggerContext) : defaultLogger;
  const metadataRecords = await options.dynamicLoader.loadMetadata(options.envKey, options.criticality, {
    failFast: options.failFast,
  });

  for (const metadata of metadataRecords) {
    options.register(metadata);
    logger.log(`Registered dynamic provider metadata '${metadata.id}' from ${options.envKey}`);
  }
}

export type { DynamicProviderLoaderService };
