import { inject, type EnvironmentProviders, provideAppInitializer } from '@angular/core';

import { OidcAuthService } from './oidc-auth.service';

/**
 * Initializes OIDC sign-in before the first navigation (completes the provider redirect, restores the session).
 * Safe to register unconditionally: it does nothing unless the runtime `authentication.type` is `oidc`.
 */
export function provideOidc(): EnvironmentProviders {
  return provideAppInitializer(() => inject(OidcAuthService).initialize());
}
