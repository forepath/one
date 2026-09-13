import { InjectionToken } from '@angular/core';

import { environment } from './environment';
import { Environment } from './environment.interface';

export const ENVIRONMENT = new InjectionToken<Environment>('Environment');

/** Client-side timeout for `GET /config` so a slow/unreachable CONFIG proxy cannot stall bootstrap. */
export const RUNTIME_CONFIG_CLIENT_FETCH_TIMEOUT_MS = 2000;

/** Must match Express HTML inject id in `@forepath/shared/frontend/util-express-server`. */
export const RUNTIME_CONFIG_ELEMENT_ID = 'runtime-config';

function mergeEnvironmentOverrides(base: Environment, overrides: Partial<Environment> | null | undefined): Environment {
  if (!overrides) {
    return base;
  }

  return {
    ...base,
    ...overrides,
    controller: overrides.controller ? { ...base.controller, ...overrides.controller } : base.controller,
    billing: overrides.billing ? { ...base.billing, ...overrides.billing } : base.billing,
    authentication: overrides.authentication
      ? { ...base.authentication, ...overrides.authentication }
      : base.authentication,
    authMarketing: overrides.authMarketing ? { ...base.authMarketing, ...overrides.authMarketing } : base.authMarketing,
    authLayout: overrides.authLayout ? { ...base.authLayout, ...overrides.authLayout } : base.authLayout,
    chatModelOptions: overrides.chatModelOptions
      ? { ...base.chatModelOptions, ...overrides.chatModelOptions }
      : base.chatModelOptions,
    editor: overrides.editor ? { ...base.editor, ...overrides.editor } : base.editor,
    deployment: overrides.deployment ? { ...base.deployment, ...overrides.deployment } : base.deployment,
    cookieConsent: overrides.cookieConsent ? { ...base.cookieConsent, ...overrides.cookieConsent } : base.cookieConsent,
    socialPreview: overrides.socialPreview ? { ...base.socialPreview, ...overrides.socialPreview } : base.socialPreview,
    docs: overrides.docs ? { ...base.docs, ...overrides.docs } : base.docs,
  } as Environment;
}

/**
 * Reads runtime config inlined into the SPA shell by Express (`#runtime-config`).
 * Returns `null` when absent or invalid so callers can fall back to `GET /config`.
 */
export function readInlineRuntimeConfigOverrides(): Partial<Environment> | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const element = document.getElementById(RUNTIME_CONFIG_ELEMENT_ID);

  if (!element?.textContent?.trim()) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(element.textContent);

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Partial<Environment>;
  } catch {
    return null;
  }
}

export async function loadRuntimeEnvironment(): Promise<Environment> {
  const inlineOverrides = readInlineRuntimeConfigOverrides();

  if (inlineOverrides !== null) {
    return mergeEnvironmentOverrides(environment, inlineOverrides);
  }

  try {
    const response: Response = await fetch('/config', {
      signal: AbortSignal.timeout(RUNTIME_CONFIG_CLIENT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return environment;
    }

    const overrides: Partial<Environment> = await response.json();

    return mergeEnvironmentOverrides(environment, overrides);
  } catch {
    return environment;
  }
}
