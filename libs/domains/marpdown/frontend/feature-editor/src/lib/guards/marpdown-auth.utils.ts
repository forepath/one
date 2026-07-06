import { inject } from '@angular/core';
import { KeycloakService } from 'keycloak-angular';
import { IDENTITY_AUTH_ENVIRONMENT, type IdentityAuthEnvironment } from '@forepath/identity/frontend';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

export function hasMarpdownAuthenticatedSession(environment: IdentityAuthEnvironment = inject(IDENTITY_AUTH_ENVIRONMENT)): boolean {
  if (environment.authentication.type === 'keycloak') {
    const keycloakService = inject(KeycloakService, { optional: true });

    return keycloakService?.isLoggedIn() ?? false;
  }

  if (environment.authentication.type === 'api-key') {
    if (environment.authentication.apiKey) {
      return true;
    }

    return Boolean(localStorage.getItem(API_KEY_STORAGE_KEY));
  }

  if (environment.authentication.type === 'users') {
    const jwt = localStorage.getItem(USERS_JWT_STORAGE_KEY);

    if (!jwt) {
      return false;
    }

    try {
      const payload = JSON.parse(atob(jwt.split('.')[1] ?? '{}'));
      const exp = payload.exp ? payload.exp * 1000 : 0;

      return exp > Date.now();
    } catch {
      return false;
    }
  }

  return false;
}
