import { InjectionToken } from '@angular/core';
import type { AuthLayoutConfig } from '@forepath/shared/frontend/util-configuration';

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

/**
 * Client certificate authentication (`AUTHENTICATION_METHOD=mtls`): the user selects a PEM certificate (+ private
 * key) at login; the console signs short-lived certificate assertions with it (`Authorization: Certificate …`).
 * Grants full access like the API key.
 */
export interface MtlsAuthenticationConfig {
  type: 'mtls';
  /** Assertion lifetime in seconds (default 120; must not exceed the API's `MTLS_ASSERTION_MAX_LIFETIME`). */
  assertionLifetimeSeconds?: number;
  /** Required when the API sets `MTLS_ASSERTION_AUDIENCE` (same value). */
  audience?: string;
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
  | MtlsAuthenticationConfig
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

/**
 * Whether the console authenticates with a single static full-access credential (`api-key` or `mtls`): no user
 * accounts, roles, personal access tokens or apps; the console user is always the admin.
 */
export function usesStaticCredential(type: AuthenticationConfigType | null | undefined): type is 'api-key' | 'mtls' {
  return type === 'api-key' || type === 'mtls';
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
  /**
   * Optional: Legal disclosure (imprint) URL (e.g. {@code environment.cookieConsent.urls.legalDisclosure}).
   * Linked under the public auth pages' card, with the terms and privacy policy, when set.
   */
  legalDisclosureUrl?: string;
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
 * Whether the brand character should peek in on login-like pages.
 * Defaults to true when {@link AuthLayoutConfig.showMascot} is omitted.
 */
export function isAuthMascotVisible(authLayout?: AuthLayoutConfig): boolean {
  return authLayout?.showMascot !== false;
}

/**
 * Whether the brand mark stack should run off the corner of login-like pages.
 * Defaults to true when {@link AuthLayoutConfig.showMarkStack} is omitted.
 */
export function isAuthMarkStackVisible(authLayout?: AuthLayoutConfig): boolean {
  return authLayout?.showMarkStack !== false;
}
