/** Supported authentication methods. */
export type AuthenticationMethod = 'api-key' | 'mtls' | 'users' | 'oidc' | 'saml';

/** All supported authentication methods. */
export const AUTHENTICATION_METHODS: readonly AuthenticationMethod[] = ['api-key', 'mtls', 'users', 'oidc', 'saml'];

/** Default authentication method when AUTHENTICATION_METHOD is explicitly set to api-key. */
export const DEFAULT_AUTHENTICATION_METHOD: AuthenticationMethod = 'api-key';

/**
 * Resolves the effective authentication method from environment variables.
 * - `AUTHENTICATION_METHOD`: explicit choice (`api-key` | `mtls` | `users` | `oidc` | `saml`).
 * - When unset: if `STATIC_API_KEY` is set → `api-key` (backward compatibility); otherwise → `oidc`.
 *   `mtls` is never inferred: it must be selected explicitly.
 *
 * The implicit `oidc` branch is intentional: OIDC is the IdP-integrated path and aligns with enterprise
 * deployments using the customer’s identity provider. Endpoints are not anonymous; the OIDC guards still
 * enforce authentication. See **AR-004** in `SECURITY.md`.
 *
 * Unknown explicit values (including the removed `keycloak`) throw so a misconfiguration fails at boot
 * instead of silently falling back to another method.
 */
export function getAuthenticationMethod(): AuthenticationMethod {
  const raw = process.env.AUTHENTICATION_METHOD;
  const explicit = raw?.toLowerCase().trim();

  if (explicit) {
    if ((AUTHENTICATION_METHODS as readonly string[]).includes(explicit)) {
      return explicit as AuthenticationMethod;
    }

    if (explicit === 'keycloak') {
      throw new Error(
        'AUTHENTICATION_METHOD=keycloak is no longer supported. Use AUTHENTICATION_METHOD=oidc (Keycloak is a standard OIDC provider) and replace KEYCLOAK_* with OIDC_* variables.',
      );
    }

    throw new Error(
      `Unsupported AUTHENTICATION_METHOD "${raw}". Expected one of: ${AUTHENTICATION_METHODS.join(', ')}.`,
    );
  }

  if (process.env.STATIC_API_KEY) {
    return 'api-key';
  }

  return 'oidc';
}

/** Methods whose interactive users are authenticated by an external identity provider. */
export function isExternalIdentityMethod(method: AuthenticationMethod = getAuthenticationMethod()): boolean {
  return method === 'oidc' || method === 'saml';
}

/** Methods that resolve requests to rows of the local `users` table (and therefore support PATs and roles). */
export function usesLocalUserAccounts(method: AuthenticationMethod = getAuthenticationMethod()): boolean {
  return method === 'users' || method === 'oidc' || method === 'saml';
}

/** Methods whose interactive sessions are app-signed JWTs (password login or SAML assertion exchange). */
export function usesAppSessionJwt(method: AuthenticationMethod = getAuthenticationMethod()): boolean {
  return method === 'users' || method === 'saml';
}

/** Synthetic principal id of requests authenticated with the static API key. */
export const API_KEY_PRINCIPAL_ID = 'api-key-user';

/** Synthetic principal id of requests authenticated with a trusted client certificate (mTLS). */
export const MTLS_PRINCIPAL_ID = 'mtls-user';

/**
 * Methods whose single credential (static API key or trusted client certificate) grants full admin access to every
 * endpoint and websocket: there are no user accounts, roles, PATs or apps. Requests are marked
 * `apiKeyAuthenticated`, so every access rule that exempts the API key exempts client certificates as well.
 */
export function usesStaticCredential(method: AuthenticationMethod = getAuthenticationMethod()): boolean {
  return method === 'api-key' || method === 'mtls';
}

/** Synthetic principal id of a static-credential method; `undefined` for user-account methods. */
export function getStaticCredentialPrincipalId(
  method: AuthenticationMethod = getAuthenticationMethod(),
): string | undefined {
  if (method === 'api-key') {
    return API_KEY_PRINCIPAL_ID;
  }

  if (method === 'mtls') {
    return MTLS_PRINCIPAL_ID;
  }

  return undefined;
}
