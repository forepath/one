import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import {
  API_KEY_STORAGE_KEY,
  IDENTITY_AUTH_ENVIRONMENT,
  isUsersConsoleJwtValid,
  OidcAuthService,
  USERS_JWT_STORAGE_KEY,
  usesAppSessionJwt,
} from '@forepath/identity/frontend';

/**
 * Allows anonymous access to the public withdrawal page while sending already
 * authenticated users straight to their subscriptions instead of the shared
 * login redirect target (which is not a route in the billing console).
 */
export const publicWithdrawalAccessGuard: CanActivateFn = () => {
  const environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  const router = inject(Router);
  const subscriptionsUrl = router.createUrlTree(['/subscriptions']);
  const type = environment.authentication.type;

  if (type === 'oidc') {
    return inject(OidcAuthService).isLoggedIn() ? subscriptionsUrl : true;
  }

  if (type === 'api-key') {
    if (environment.authentication.apiKey || localStorage.getItem(API_KEY_STORAGE_KEY)) {
      return subscriptionsUrl;
    }

    return true;
  }

  if (usesAppSessionJwt(type)) {
    return isUsersConsoleJwtValid(localStorage.getItem(USERS_JWT_STORAGE_KEY)) ? subscriptionsUrl : true;
  }

  return true;
};
