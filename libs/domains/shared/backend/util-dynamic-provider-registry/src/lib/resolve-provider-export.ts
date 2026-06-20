import type { ModuleRef } from '@nestjs/core';

import { readProviderExportHint } from './load-provider-module';
import type { ProviderCreateFactory, ProviderMetadataRecord, ResolveProviderExportOptions } from './types';

export class ProviderExportContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderExportContractError';
  }
}

export interface ResolvedProviderExport<T> {
  kind: 'createProvider' | 'class' | 'testFixture';
  createProvider?: ProviderCreateFactory<T>;
  providerClass?: new (...args: unknown[]) => T;
}

/**
 * Resolves plugin package exports. Generic `provider` / `Provider` are rejected unless test fixtures.
 */
export function resolveProviderExport<T>(
  module: Record<string, unknown>,
  options: ResolveProviderExportOptions,
): ResolvedProviderExport<T> {
  const createProvider = module['createProvider'];

  if (typeof createProvider === 'function') {
    return {
      kind: 'createProvider',
      createProvider: createProvider as ProviderCreateFactory<T>,
    };
  }

  const classExportName =
    options.entry.classExport ??
    readProviderExportHint(options.loadTarget?.specifier ?? options.entry.specifier, process.cwd(), options.loadTarget);

  if (classExportName) {
    const providerClass = module[classExportName];

    if (typeof providerClass === 'function') {
      return {
        kind: 'class',
        providerClass: providerClass as new (...args: unknown[]) => T,
      };
    }

    throw new ProviderExportContractError(
      `Provider package '${options.entry.specifier}' declares class export '${classExportName}' but it is missing or not a constructor`,
    );
  }

  if (options.allowTestFixtureExports) {
    const fixtureExport = module['provider'] ?? module['Provider'];

    if (typeof fixtureExport === 'function') {
      return {
        kind: 'testFixture',
        providerClass: fixtureExport as new (...args: unknown[]) => T,
      };
    }
  }

  throw new ProviderExportContractError(
    `Provider package '${options.entry.specifier}' must export 'createProvider' or a named PascalCase class ` +
      `(via entry alias or package.json forepath.providerExport). Generic 'provider'/'Provider' exports are not accepted.`,
  );
}

export async function instantiateResolvedProvider<T>(
  resolved: ResolvedProviderExport<T>,
  moduleRef: ModuleRef,
): Promise<T> {
  if (resolved.kind === 'createProvider' && resolved.createProvider) {
    return await resolved.createProvider(moduleRef);
  }

  if (resolved.providerClass) {
    return moduleRef.create(resolved.providerClass);
  }

  throw new ProviderExportContractError('Resolved provider export has no instantiable export');
}

export function resolveProviderMetadata(module: Record<string, unknown>): ProviderMetadataRecord | undefined {
  const metadata = module['providerMetadata'];

  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const record = metadata as ProviderMetadataRecord;

  if (!record.id || !record.displayName) {
    throw new ProviderExportContractError('providerMetadata export must include id and displayName');
  }

  return record;
}
