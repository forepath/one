import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { assertRuntimeDependency, RuntimeDependencyError } from './assert-runtime-dependency';
import { isFilePluginEntry } from './parse-provider-package-spec';
import { buildPluginPathTargetFromRelativePath, lookupPluginPathTarget } from './plugin-path-index';
import type { ProviderLoadTarget, ProviderPackageEntry, ResolveProviderLoadTargetOptions } from './types';

export class ProviderLoadTargetError extends Error {
  constructor(
    message: string,
    readonly entry: ProviderPackageEntry,
    readonly envKey?: string,
  ) {
    super(message);
    this.name = 'ProviderLoadTargetError';
  }
}

export function resolveProviderLoadTarget(
  entry: ProviderPackageEntry,
  options: ResolveProviderLoadTargetOptions = {},
): ProviderLoadTarget {
  const appRoot = options.appRoot ?? process.cwd();
  const pluginPath = options.pluginPath;
  const envKey = options.envKey;

  if (isFilePluginEntry(entry)) {
    if (!pluginPath) {
      throw new ProviderLoadTargetError(
        `Plugin entry '${entry.specifier}' requires ${'DYNAMIC_PROVIDER_PLUGIN_PATH'} to be set`,
        entry,
        envKey,
      );
    }

    return buildPluginPathTargetFromRelativePath(entry.pluginRelativePath!, pluginPath, options.allowlistPrefixes);
  }

  try {
    assertRuntimeDependency(entry.specifier, { ...options, appRoot, envKey });

    const require = createRequire(join(appRoot, 'package.json'));
    const resolvedEntry = require.resolve(entry.specifier);
    const packageJsonPath = require.resolve(`${entry.specifier}/package.json`);
    const manifest = require(packageJsonPath) as { main?: string };

    return {
      source: 'baked-in',
      specifier: entry.specifier,
      entryPath: dirname(packageJsonPath),
      packageJsonPath,
      mainPath: manifest.main ? join(dirname(packageJsonPath), manifest.main) : resolvedEntry,
    };
  } catch (error) {
    if (!(error instanceof RuntimeDependencyError) || !pluginPath) {
      if (error instanceof RuntimeDependencyError) {
        throw new ProviderLoadTargetError(error.message, entry, envKey);
      }

      throw error;
    }

    const pluginTarget = lookupPluginPathTarget(entry.specifier, pluginPath, options.allowlistPrefixes);

    if (!pluginTarget) {
      throw new ProviderLoadTargetError(
        `Package '${entry.specifier}' is not baked into app root '${appRoot}' and was not found under plugin path '${pluginPath}'`,
        entry,
        envKey,
      );
    }

    return pluginTarget;
  }
}
