import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import type { IdentityAuthEnvironment } from '@forepath/identity/frontend';
import {
  IDENTITY_AUTH_ENVIRONMENT,
  isUsersConsoleJwtValid,
  jwtPayloadHasPatAmr,
  parseJwtPayload,
} from '@forepath/identity/frontend';
import { KeycloakService } from 'keycloak-angular';

/**
 * LocalStorage key for storing the API key
 */
const API_KEY_STORAGE_KEY = 'agent-controller-api-key';
/**
 * LocalStorage key for storing the JWT (users authentication)
 */
const USERS_JWT_STORAGE_KEY = 'agent-controller-users-jwt';

/**
 * Guard that prevents authenticated users from accessing the login route.
 * - If authentication type is 'keycloak', checks if user is authenticated and redirects to /clients if so
 * - If authentication type is 'api-key', checks if API key exists in environment or localStorage and redirects to /clients if so
 * - If authentication type is 'users', checks if valid password-session JWT exists in localStorage and redirects to /clients if so
 * - Personal access token JWTs are cleared so the login form remains reachable
 * - Otherwise, allows access to login route
 */
export const loginGuard: CanActivateFn = (_route, _state) => {
  const environment = inject<IdentityAuthEnvironment>(IDENTITY_AUTH_ENVIRONMENT);
  const router = inject(Router);

  if (environment.authentication.type === 'keycloak') {
    const keycloakService = inject(KeycloakService, { optional: true });

    if (keycloakService) {
      // Check if user is authenticated
      const isAuthenticated = keycloakService.isLoggedIn();

      if (isAuthenticated) {
        // User is already authenticated, redirect to dashboard
        return router.createUrlTree(['/clients']);
      } else {
        // Login to Keycloak
        keycloakService.login();
      }
    }

    // User is not authenticated, allow access to login
    return true;
  }

  if (environment.authentication.type === 'api-key') {
    // Check if API key exists in environment
    const envApiKey = environment.authentication.apiKey;

    if (envApiKey) {
      // API key found in environment, user is "logged in", redirect to dashboard
      return router.createUrlTree(['/clients']);
    }

    // Check if API key exists in localStorage
    const storedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);

    if (storedApiKey) {
      // API key found in localStorage, user is "logged in", redirect to dashboard
      return router.createUrlTree(['/clients']);
    }

    // No API key found, allow access to login
    return true;
  }

  if (environment.authentication.type === 'users') {
    const jwt = localStorage.getItem(USERS_JWT_STORAGE_KEY);

    if (jwt) {
      const payload = parseJwtPayload(jwt);

      if (jwtPayloadHasPatAmr(payload)) {
        localStorage.removeItem(USERS_JWT_STORAGE_KEY);

        return true;
      }

      if (isUsersConsoleJwtValid(jwt)) {
        return router.createUrlTree(['/clients']);
      }
    }

    return true;
  }

  // For other authentication types, allow access to login
  return true;
};
