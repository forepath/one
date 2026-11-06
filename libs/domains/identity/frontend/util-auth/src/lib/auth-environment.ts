import { InjectionToken } from '@angular/core';
import type { AuthLayoutConfig, AuthMarketing } from '@forepath/shared/frontend/util-configuration';

/**
 * Authentication configuration types.
 * These define the shape of the authentication config section
 * in the application environment.
 */

/**
 * Generic OpenID Connect (any compliant provider, e.g. Keycloak, Entra ID, Auth0, Okta).
 * The console runs the Authorization Code flow with PKCE as a public client and sends the access token
 * to the API (`AUTHENTICATION_METHOD=oidc`).
 */
export interface OidcAuthenticationConfig {
  type: 'oidc';
  /** Issuer URL; discovery is loaded from `<issuer>/.well-known/openid-configuration`. */
  issuer: string;
  /** Public (SPA) client id registered at the provider. */
  clientId: string;
  /** Requested scopes (default `openid profile email`). */
  scope?: string;
  /** Where the provider sends the browser after logout (default: console base URL). */
  postLogoutRedirectUri?: string;
}

/**
 * SAML 2.0 via the API (service provider): the console starts sign-in at `<apiUrl>/auth/saml/login`
 * and exchanges the one-time code for an app session JWT (`AUTHENTICATION_METHOD=saml`).
 */
export interface SamlAuthenticationConfig {
  type: 'saml';
}

export interface ApiKeyAuthenticationConfig {
  type: 'api-key';
  apiKey?: string;
}

export interface UsersAuthenticationConfig {
  type: 'users';
  disableSignup?: boolean;
  /** When true, mirrors backend DISABLE_FORCE_LOGIN_2FA (force login 2FA off). */
  disableForceLogin2fa?: boolean;
}

export type AuthenticationConfig =
  | OidcAuthenticationConfig
  | SamlAuthenticationConfig
  | ApiKeyAuthenticationConfig
  | UsersAuthenticationConfig;

/** Authentication method of the console (`authentication.type`). */
export type AuthenticationConfigType = AuthenticationConfig['type'];

/**
 * Whether the console session is an app-signed JWT kept in localStorage (`users` password login or `saml`
 * assertion exchange). Interceptors, guards, sockets and logout share the users-mode handling for both.
 */
export function usesAppSessionJwt(type: AuthenticationConfigType | null | undefined): boolean {
  return type === 'users' || type === 'saml';
}

/** Whether interactive sign-in happens at an external identity provider (OIDC or SAML). */
export function usesExternalSignIn(type: AuthenticationConfigType | null | undefined): type is 'oidc' | 'saml' {
  return type === 'oidc' || type === 'saml';
}

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
  /** Optional tenant id of multi-tenant APIs (sent as `tenant` on SAML sign-in, which cannot carry `X-Tenant`). */
  tenantId?: string;
  /**
   * Optional: The full REST API URL for the controller.
   * Used by the login component to display the API hostname for API-key auth.
   * If not provided, the apiBaseHostname display is hidden.
   */
  controllerApiUrl?: string;
  /**
   * Optional: Terms of service URL (e.g. {@code environment.cookieConsent.urls.terms}).
   * Used by registration UI when both this and {@link privacyPolicyUrl} are set.
   */
  termsUrl?: string;
  /**
   * Optional: Privacy policy URL (e.g. {@code environment.cookieConsent.urls.privacyPolicy}).
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
 *     apiUrl: env.console.urls.restApi,
 *     authentication: env.authentication.config,
 *     termsUrl: env.cookieConsent.urls.terms,
 *     privacyPolicyUrl: env.cookieConsent.urls.privacyPolicy,
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
