import { createRequire } from 'node:module';
import { join } from 'node:path';

import { DEFAULT_SPECIFIER_ALLOWLIST_PREFIXES } from './types';
import type { AssertRuntimeDependencyOptions } from './types';

export class RuntimeDependencyError extends Error {
  constructor(
    message: string,
    readonly specifier: string,
    readonly appRoot: string,
    readonly envKey?: string,
  ) {
    super(message);
    this.name = 'RuntimeDependencyError';
  }
}

export class SpecifierAllowlistError extends Error {
  constructor(
    message: string,
    readonly specifier: string,
  ) {
    super(message);
    this.name = 'SpecifierAllowlistError';
  }
}

/**
 * Hard gate: the specifier must be allowlisted and resolvable from the app root package.json.
 */
export function assertRuntimeDependency(specifier: string, options: AssertRuntimeDependencyOptions = {}): void {
  const appRoot = options.appRoot ?? process.cwd();
  const envKey = options.envKey;
  const allowlistPrefixes = options.allowlistPrefixes ?? DEFAULT_SPECIFIER_ALLOWLIST_PREFIXES;

  assertAllowlistedSpecifier(specifier, allowlistPrefixes);

  try {
    const require = createRequire(join(appRoot, 'package.json'));

    require.resolve(specifier);
  } catch (cause) {
    const envSuffix = envKey ? ` (env: ${envKey})` : '';

    throw new RuntimeDependencyError(
      `Package '${specifier}' is not a runtime dependency of app root '${appRoot}'${envSuffix}. ` +
        'Add it to the consuming backend application deploy graph before listing it in a DYNAMIC_* env var.',
      specifier,
      appRoot,
      envKey,
    );
  }
}

export function assertAllowlistedSpecifier(
  specifier: string,
  allowlistPrefixes: readonly string[] = DEFAULT_SPECIFIER_ALLOWLIST_PREFIXES,
): void {
  const allowed = allowlistPrefixes.some((prefix) => specifier.startsWith(prefix));

  if (!allowed) {
    throw new SpecifierAllowlistError(
      `Package specifier '${specifier}' is not allowlisted. Allowed prefixes: ${allowlistPrefixes.join(', ')}`,
      specifier,
    );
  }
}
