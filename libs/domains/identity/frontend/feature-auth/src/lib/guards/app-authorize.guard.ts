import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import {
  IDENTITY_AUTH_ENVIRONMENT,
  storePostLoginReturnUrl,
  usesAppSessionJwt,
  type IdentityAuthEnvironment,
} from '@forepath/identity/frontend';

import { authGuard, hasValidConsoleSessionJwt } from './auth.guard';

/**
 * Grant page guard: the user must be signed in interactively.
 * - users / saml mode: without a valid console session, remember the grant URL and send the user to sign in;
 *   sign-in resumes the grant page afterwards.
 * - oidc mode: the provider login redirects back to the requested URL.
 * - api-key mode: apps are not available.
 */
export const appAuthorizeGuard: CanActivateFn = (route, state) => {
  const environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  const router = inject(Router);
  const type = environment.authentication.type;

  if (usesAppSessionJwt(type)) {
    if (hasValidConsoleSessionJwt()) {
      return true;
    }

    storePostLoginReturnUrl(state.url);

    return authGuard(route, state);
  }

  if (type === 'oidc') {
    return authGuard(route, state);
  }

  return router.createUrlTree(['/']);
};
