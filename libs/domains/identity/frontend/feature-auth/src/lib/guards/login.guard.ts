import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import {
  API_KEY_STORAGE_KEY,
  consumePostLoginReturnUrl,
  hasMtlsCredential,
  IDENTITY_AUTH_ENVIRONMENT,
  OidcAuthService,
  SSO_ERROR_QUERY_PARAM,
  startSamlLogin,
  usesAppSessionJwt,
} from '@forepath/identity/frontend';

import { hasValidConsoleSessionJwt } from './auth.guard';

/**
 * Guard that prevents authenticated users from accessing the login route.
 * - 'oidc' / 'saml': signed-in users go to the role home (/); otherwise sign-in starts at the identity provider right away
 *   (unless the previous attempt failed: `?sso_error=…` keeps the login page with a retry button)
 * - 'api-key': redirects to the role home (/) when an API key exists in environment or localStorage
 * - 'mtls': redirects to the role home (/) when a valid client certificate is stored
 * - 'users': redirects to the role home (/) when a valid password-session JWT exists in localStorage
 * - Personal access token JWTs are cleared so the login form remains reachable
 * - Otherwise, allows access to login route
 */
export const loginGuard: CanActivateFn = (route) => {
  const environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);
  const type = environment.authentication.type;

  if (type === 'oidc' || type === 'saml') {
    if (isPlatformServer(platformId)) {
      return true;
    }

    const signedIn = type === 'oidc' ? inject(OidcAuthService).isLoggedIn() : hasValidConsoleSessionJwt();

    if (signedIn) {
      return router.createUrlTree(['/']);
    }

    if (!route.queryParamMap.get(SSO_ERROR_QUERY_PARAM)) {
      const returnUrl = consumePostLoginReturnUrl() ?? undefined;

      void (type === 'oidc'
        ? inject(OidcAuthService).login(returnUrl)
        : startSamlLogin(environment.apiUrl, returnUrl, environment.tenantId));
    }

    return true;
  }

  if (type === 'api-key') {
    if (environment.authentication.apiKey || localStorage.getItem(API_KEY_STORAGE_KEY)) {
      return router.createUrlTree(['/']);
    }

    return true;
  }

  if (type === 'mtls') {
    if (isPlatformServer(platformId)) {
      return true;
    }

    return hasMtlsCredential().then((hasCredential) => (hasCredential ? router.createUrlTree(['/']) : true));
  }

  if (usesAppSessionJwt(type)) {
    return hasValidConsoleSessionJwt() ? router.createUrlTree(['/']) : true;
  }

  // For other authentication types, allow access to login
  return true;
};
