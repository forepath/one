import { InjectionToken } from '@angular/core';

import { environment } from './environment';
import { Environment } from './environment.interface';

export const ENVIRONMENT = new InjectionToken<Environment>('Environment');

function mergeEnvironmentOverrides(base: Environment, overrides: Partial<Environment> | null | undefined): Environment {
  if (!overrides) {
    return base;
  }

  // Shallow merge is sufficient for our use cases; we trust remote config to provide full objects
  // where necessary. We assert the type to avoid over-constraining optional fields.
  return {
    ...base,
    ...overrides,
  } as Environment;
}

export async function loadRuntimeEnvironment(): Promise<Environment> {
  try {
    const response: Response = await fetch('/config');

    if (!response.ok) {
      return environment;
    }

    const overrides: Partial<Environment> = await response.json();

    return mergeEnvironmentOverrides(environment, overrides);
  } catch {
    return environment;
  }
}
