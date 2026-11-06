import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

// Import from util-auth barrel directly to avoid circular dependency
// (feature-auth is re-exported from the @forepath/identity/frontend barrel)
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  API_KEY_STORAGE_KEY,
  IDENTITY_AUTH_ENVIRONMENT,
  isUsersConsoleJwtValid,
  jwtPayloadHasPatAmr,
  OidcAuthService,
  parseJwtPayload,
  startSamlLogin,
  USERS_JWT_STORAGE_KEY,
  usesAppSessionJwt,
  type IdentityAuthEnvironment,
} from '../../../../util-auth/src';

/** True when localStorage holds a valid, non-PAT console session JWT (users / saml); clears PAT JWTs. */
export function hasValidConsoleSessionJwt(): boolean {
  const jwt = localStorage.getItem(USERS_JWT_STORAGE_KEY);

  if (!jwt) {
    return false;
  }

  if (jwtPayloadHasPatAmr(parseJwtPayload(jwt))) {
    localStorage.removeItem(USERS_JWT_STORAGE_KEY);

    return false;
  }

  return isUsersConsoleJwtValid(jwt);
}

/**
 * Guard that protects routes based on authentication configuration.
 * - 'oidc': requires an OIDC session; otherwise redirects to the identity provider (returning to the requested URL)
 * - 'saml': requires a valid session JWT; otherwise starts SAML sign-in at the API (returning to the requested URL)
 * - 'api-key': allows access if an API key exists in environment or localStorage
 * - 'users': allows access if a valid password-session JWT exists in localStorage
 * - Personal access token JWTs (`amr` includes `pat`) are cleared and treated as logged out
 * - Otherwise, redirects to /login
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);
  const type = environment.authentication.type;

  if (type === 'oidc') {
    // The session lives in browser storage; the server render cannot decide.
    if (isPlatformServer(platformId)) {
      return true;
    }

    const oidcAuthService = inject(OidcAuthService);

    if (oidcAuthService.isLoggedIn()) {
      return true;
    }

    void oidcAuthService.login(state.url);

    return false;
  }

  if (type === 'api-key') {
    if (environment.authentication.apiKey || localStorage.getItem(API_KEY_STORAGE_KEY)) {
      return true;
    }

    return router.createUrlTree(['/login']);
  }

  if (usesAppSessionJwt(type)) {
    if (hasValidConsoleSessionJwt()) {
      return true;
    }

    if (type === 'saml' && !isPlatformServer(platformId)) {
      void startSamlLogin(environment.apiUrl, state.url, environment.tenantId);

      return false;
    }

    return router.createUrlTree(['/login']);
  }

  // For other authentication types, redirect to login
  return router.createUrlTree(['/login']);
};
