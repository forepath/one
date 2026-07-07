import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import { IDENTITY_AUTH_ENVIRONMENT } from '@forepath/identity/frontend';
import { KeycloakService } from 'keycloak-angular';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

/**
 * Allows anonymous access to the public withdrawal page while sending already
 * authenticated users straight to their subscriptions instead of the shared
 * login redirect target (which is not a route in the billing console).
 */
export const publicWithdrawalAccessGuard: CanActivateFn = () => {
  const environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  const router = inject(Router);
  const subscriptionsUrl = router.createUrlTree(['/subscriptions']);

  if (environment.authentication.type === 'keycloak') {
    const keycloakService = inject(KeycloakService, { optional: true });

    if (keycloakService?.isLoggedIn()) {
      return subscriptionsUrl;
    }

    return true;
  }

  if (environment.authentication.type === 'api-key') {
    if (environment.authentication.apiKey || localStorage.getItem(API_KEY_STORAGE_KEY)) {
      return subscriptionsUrl;
    }

    return true;
  }

  if (environment.authentication.type === 'users') {
    const jwt = localStorage.getItem(USERS_JWT_STORAGE_KEY);

    if (jwt) {
      try {
        const payload = JSON.parse(atob(jwt.split('.')[1] ?? '{}'));
        const exp = payload.exp ? payload.exp * 1000 : 0;

        if (exp > Date.now()) {
          return subscriptionsUrl;
        }
      } catch {
        return true;
      }
    }

    return true;
  }

  return true;
};
