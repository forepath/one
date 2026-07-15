import { InjectionToken } from '@angular/core';
import type { AuthLayoutConfig, AuthMarketing } from '@forepath/shared/frontend/util-configuration';

/**
 * Authentication configuration types.
 * These define the shape of the authentication config section
 * in the application environment.
 */

export interface KeycloakAuthenticationConfig {
  type: 'keycloak';
  authServerUrl: string;
  realm: string;
  clientId: string;
}

export interface ApiKeyAuthenticationConfig {
  type: 'api-key';
  apiKey?: string;
}

export interface UsersAuthenticationConfig {
  type: 'users';
  disableSignup?: boolean;
}

export type AuthenticationConfig =
  | KeycloakAuthenticationConfig
  | ApiKeyAuthenticationConfig
  | UsersAuthenticationConfig;

/**
 * Minimal environment interface required by identity auth features.
 * Consuming applications provide a value for this token that maps
 * from their full environment to these auth-relevant fields.
 */
export interface IdentityAuthEnvironment {
  /** Product name shown on auth screens and in page titles. */
  productName: string;
  /** Brand-specific copy for login, registration, and related auth screens. */
  authMarketing: AuthMarketing;
  /** Layout options for login, registration, and related public auth screens. */
  authLayout?: AuthLayoutConfig;
  /** The base URL of the REST API (used to scope auth headers to API requests) */
  apiUrl: string;
  /**
   * Optional: Additional base URLs that should receive the same auth token (e.g. billing API).
   * Requests whose URL starts with any of these will get the Authorization header.
   */
  additionalApiUrls?: string[];
  /** Authentication configuration */
  authentication: AuthenticationConfig;
  /**
   * Optional: The full REST API URL for the controller.
   * Used by the login component to display the API hostname for API-key auth.
   * If not provided, the apiBaseHostname display is hidden.
   */
  controllerApiUrl?: string;
  /**
   * Optional: Terms of service URL (e.g. {@code environment.cookieConsent.termsUrl}).
   * Used by registration UI when both this and {@link privacyPolicyUrl} are set.
   */
  termsUrl?: string;
  /**
   * Optional: Privacy policy URL (e.g. {@code environment.cookieConsent.privacyPolicyUrl}).
   * Used by registration UI when both this and {@link termsUrl} are set.
   */
  privacyPolicyUrl?: string;
}

/**
 * Injection token for the identity auth environment.
 * Applications must provide this token with an `IdentityAuthEnvironment` value.
 *
 * @example
 * ```typescript
 * import { IDENTITY_AUTH_ENVIRONMENT } from '@forepath/identity/frontend';
 * import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
 *
 * {
 *   provide: IDENTITY_AUTH_ENVIRONMENT,
 *   useFactory: (env: Environment) => ({
 *     apiUrl: env.controller.restApiUrl,
 *     authentication: env.authentication,
 *     termsUrl: env.cookieConsent.termsUrl,
 *     privacyPolicyUrl: env.cookieConsent.privacyPolicyUrl,
 *   }),
 *   deps: [ENVIRONMENT],
 * }
 * ```
 */
export const IDENTITY_AUTH_ENVIRONMENT = new InjectionToken<IdentityAuthEnvironment>('IdentityAuthEnvironment');

/**
 * Whether the left marketing panel should be shown on login-like pages.
 * Defaults to true when {@link AuthLayoutConfig.showMarketingPanel} is omitted.
 */
export function isAuthMarketingPanelVisible(authLayout?: AuthLayoutConfig): boolean {
  return authLayout?.showMarketingPanel !== false;
}
