export interface ExtensionWebpackExternalsOptions {
  extensionsEnvKeys: readonly string[];
  additionalNpmPackages?: readonly string[];
}

export function extractNpmPackageFromSpecifier(specifier: string): string | undefined {
  const trimmed = specifier.trim();

  if (trimmed.startsWith('npm:')) {
    const packageName = trimmed.slice('npm:'.length).trim();

    return packageName.length > 0 ? packageName : undefined;
  }

  return undefined;
}

export function collectNpmPackagesFromExtensionEnvKeys(envKeys: readonly string[]): string[] {
  const packages = new Set<string>();

  for (const envKey of envKeys) {
    const raw = process.env[envKey];

    if (!raw || raw.trim().length === 0) {
      continue;
    }

    for (const part of raw.split(',')) {
      const packageName = extractNpmPackageFromSpecifier(part);

      if (packageName) {
        packages.add(packageName);
      }
    }
  }

  return [...packages];
}

type WebpackExternalsCallback = (error?: Error | null, result?: string) => void;

interface WebpackExternalsContext {
  request?: string;
}

export function createExtensionExternalsPredicate(
  packageNames: readonly string[],
): (context: WebpackExternalsContext, callback: WebpackExternalsCallback) => void {
  const packages = new Set(packageNames);

  return function extensionExternals({ request }, callback) {
    if (!request) {
      callback();

      return;
    }

    if (packages.has(request)) {
      callback(null, `commonjs ${request}`);

      return;
    }

    for (const packageName of packages) {
      if (request.startsWith(`${packageName}/`)) {
        callback(null, `commonjs ${request}`);

        return;
      }
    }

    callback();
  };
}

export interface WebpackConfigLike {
  externals?: unknown;
}

export function applyExtensionWebpackExternals(
  config: WebpackConfigLike,
  options: ExtensionWebpackExternalsOptions,
): WebpackConfigLike {
  const envPackages = collectNpmPackagesFromExtensionEnvKeys(options.extensionsEnvKeys);
  const npmPackages = [...new Set([...envPackages, ...(options.additionalNpmPackages ?? [])])];

  if (npmPackages.length === 0) {
    return config;
  }

  const predicate = createExtensionExternalsPredicate(npmPackages);

  if (!config.externals) {
    config.externals = [predicate];
  } else if (Array.isArray(config.externals)) {
    config.externals.push(predicate);
  } else {
    config.externals = [config.externals, predicate];
  }

  return config;
}
