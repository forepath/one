import { InjectionToken } from '@angular/core';

import { environment } from './environment';
import { Environment } from './environment.interface';

export const ENVIRONMENT = new InjectionToken<Environment>('Environment');

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
    chatModelOptions: overrides.chatModelOptions
      ? { ...base.chatModelOptions, ...overrides.chatModelOptions }
      : base.chatModelOptions,
    editor: overrides.editor ? { ...base.editor, ...overrides.editor } : base.editor,
    deployment: overrides.deployment ? { ...base.deployment, ...overrides.deployment } : base.deployment,
    cookieConsent: overrides.cookieConsent ? { ...base.cookieConsent, ...overrides.cookieConsent } : base.cookieConsent,
    socialPreview: overrides.socialPreview ? { ...base.socialPreview, ...overrides.socialPreview } : base.socialPreview,
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
