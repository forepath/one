import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import {
  IDENTITY_AUTH_ENVIRONMENT,
  isUsersConsoleJwtValid,
  jwtPayloadHasPatAmr,
  parseJwtPayload,
  storePostLoginReturnUrl,
  type IdentityAuthEnvironment,
} from '@forepath/identity/frontend';

import { authGuard } from './auth.guard';

const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

/**
 * Grant page guard: the user must be signed in interactively.
 * - users mode: without a valid console session, remember the grant URL and send the user to the login mask;
 *   login (incl. 2FA) resumes the grant page afterwards.
 * - keycloak mode: Keycloak login redirects back to the requested URL.
 * - api-key mode: apps are not available.
 */
export const appAuthorizeGuard: CanActivateFn = (route, state) => {
  const environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  const router = inject(Router);
  const type = environment.authentication.type;

  if (type === 'users') {
    const jwt = localStorage.getItem(USERS_JWT_STORAGE_KEY);

    if (jwt && !jwtPayloadHasPatAmr(parseJwtPayload(jwt)) && isUsersConsoleJwtValid(jwt)) {
      return true;
    }

    storePostLoginReturnUrl(state.url);

    return authGuard(route, state);
  }

  if (type === 'keycloak') {
    return authGuard(route, state);
  }

  return router.createUrlTree(['/']);
};
