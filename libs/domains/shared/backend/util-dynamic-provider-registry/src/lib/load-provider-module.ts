import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

import { resolveProviderLoadTarget } from './resolve-provider-load-target';
import type { LoadProviderModuleOptions, ProviderLoadTarget, ProviderPackageEntry } from './types';

export class ProviderModuleLoadError extends Error {
  constructor(
    message: string,
    readonly entry: ProviderPackageEntry,
    readonly envKey?: string,
  ) {
    super(message);
    this.name = 'ProviderModuleLoadError';
  }
}

/**
 * Resolves load target (baked-in or plugin-path), then loads the module.
 */
export async function loadProviderModule(
  entry: ProviderPackageEntry,
  options: LoadProviderModuleOptions = {},
): Promise<Record<string, unknown>> {
  const envKey = options.envKey;
  const target = resolveProviderLoadTarget(entry, options);

  try {
    if (target.source === 'baked-in') {
      return await loadBakedInModule(target);
    }

    return await loadPluginPathModule(target);
  } catch (error) {
    throw new ProviderModuleLoadError(
      `Failed to load provider package '${target.specifier}'${envKey ? ` (env: ${envKey})` : ''}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      entry,
      envKey,
    );
  }
}

async function loadBakedInModule(target: ProviderLoadTarget): Promise<Record<string, unknown>> {
  try {
    const loaded = await import(target.specifier);

    return loaded as Record<string, unknown>;
  } catch {
    const require = createRequire(target.packageJsonPath);
    const required = require(target.mainPath) as Record<string, unknown>;

    return required;
  }
}

async function loadPluginPathModule(target: ProviderLoadTarget): Promise<Record<string, unknown>> {
  try {
    const loaded = await import(pathToFileURL(target.mainPath).href);

    return loaded as Record<string, unknown>;
  } catch {
    const require = createRequire(target.packageJsonPath);
    const required = require(target.mainPath) as Record<string, unknown>;

    return required;
  }
}

/**
 * Reads optional `forepath.providerExport` from the resolved package manifest.
 */
export function readProviderExportHint(
  specifier: string,
  appRoot: string = process.cwd(),
  loadTarget?: ProviderLoadTarget,
): string | undefined {
  const packageJsonPath = loadTarget?.packageJsonPath;

  if (packageJsonPath) {
    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        forepath?: { providerExport?: string };
      };

      return manifest.forepath?.providerExport;
    } catch {
      return undefined;
    }
  }

  try {
    const require = createRequire(`${appRoot}/package.json`);
    const resolvedPackageJsonPath = require.resolve(`${specifier}/package.json`);
    const manifest = JSON.parse(readFileSync(resolvedPackageJsonPath, 'utf8')) as {
      forepath?: { providerExport?: string };
    };

    return manifest.forepath?.providerExport;
  } catch {
    return undefined;
  }
}
