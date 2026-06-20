import { DYNAMIC_PROVIDERS_FAIL_FAST_ENV, type RegistryCriticality } from './types';

export function isDynamicProvidersFailFastEnabled(env: NodeJS.ProcessEnv = process.env, override?: boolean): boolean {
  if (override !== undefined) {
    return override;
  }

  return env[DYNAMIC_PROVIDERS_FAIL_FAST_ENV] === 'true';
}

/**
 * Returns true when startup should abort instead of skipping a failed dynamic provider entry.
 */
export function shouldFailFastOnError(
  criticality: RegistryCriticality,
  failFast?: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (criticality === 'optional') {
    return false;
  }

  return isDynamicProvidersFailFastEnabled(env, failFast);
}

export function handleDynamicProviderError(
  error: unknown,
  context: {
    criticality: RegistryCriticality;
    failFast?: boolean;
    envKey: string;
    entryLabel: string;
    onPermissive: (message: string, error: unknown) => void;
  },
): void {
  const message =
    `Failed to load dynamic provider entry '${context.entryLabel}' from ${context.envKey}: ` +
    `${error instanceof Error ? error.message : String(error)}`;

  if (shouldFailFastOnError(context.criticality, context.failFast)) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(message);
  }

  context.onPermissive(message, error);
}
