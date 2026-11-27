import { dirname, join } from 'node:path';

import type { GeneratorCallback, Tree } from '@nx/devkit';

export interface SetupDockerOptions {
  project: string;
  outputPath: string;
  buildTarget: string;
}

type SetupDockerGenerator = (tree: Tree, options: SetupDockerOptions) => Promise<GeneratorCallback>;

/**
 * Runs the `@nx/node:setup-docker` generator.
 *
 * Nx 23 no longer exports it from `@nx/node/internal`, so it is resolved through the package's
 * published generator registry, the same way `nx g @nx/node:setup-docker` finds it.
 */
export async function setupDocker(tree: Tree, options: SetupDockerOptions): Promise<GeneratorCallback> {
  const registryPath = require.resolve('@nx/node/generators.json');
  const registry: { generators: Record<string, { factory: string }> } = require(registryPath);
  const factory = registry.generators['setup-docker']?.factory;

  if (!factory) {
    throw new Error('@nx/node no longer provides the setup-docker generator');
  }

  const generatorModule: { setupDockerGenerator?: SetupDockerGenerator; default?: SetupDockerGenerator } = require(
    join(dirname(registryPath), factory),
  );
  const generator = generatorModule.setupDockerGenerator ?? generatorModule.default;

  if (!generator) {
    throw new Error('@nx/node setup-docker generator has no callable export');
  }

  return generator(tree, options);
}
