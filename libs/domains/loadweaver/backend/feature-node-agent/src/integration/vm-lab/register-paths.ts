import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { register } from 'tsconfig-paths';

/**
 * Jest's `globalSetup` / `globalTeardown` modules are required with the transform but **without** the Nx resolver
 * that maps the workspace path aliases (`@forepath/...`) for test files. The VM-lab global setups import the shared
 * harness and protocol libraries through those aliases, so they register the aliases of `tsconfig.base.json` first
 * (import this module before any aliased import).
 */
const WORKSPACE = join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..');
const base = JSON.parse(readFileSync(join(WORKSPACE, 'tsconfig.base.json'), 'utf8')) as {
  compilerOptions: { paths: Record<string, string[]> };
};

register({ baseUrl: WORKSPACE, paths: base.compilerOptions.paths, addMatchAll: false });
