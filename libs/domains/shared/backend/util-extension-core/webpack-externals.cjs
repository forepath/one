/**
 * Webpack externals helper for Forepath npm extension packages.
 * Used by backend app webpack.config.cjs files — keep in sync with webpack-externals.ts.
 */

function extractNpmPackageFromSpecifier(specifier) {
  const trimmed = specifier.trim();

  if (trimmed.startsWith('npm:')) {
    const packageName = trimmed.slice('npm:'.length).trim();

    return packageName.length > 0 ? packageName : undefined;
  }

  return undefined;
}

function collectNpmPackagesFromExtensionEnvKeys(envKeys) {
  const packages = new Set();

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

function createExtensionExternalsPredicate(packageNames) {
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

function applyExtensionWebpackExternals(config, options) {
  const envPackages = collectNpmPackagesFromExtensionEnvKeys(
    options.extensionsEnvKeys ?? [],
  );
  const additional = options.additionalNpmPackages ?? [];
  const npmPackages = [...new Set([...envPackages, ...additional])];

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

module.exports = {
  applyExtensionWebpackExternals,
  collectNpmPackagesFromExtensionEnvKeys,
  createExtensionExternalsPredicate,
  extractNpmPackageFromSpecifier,
};
