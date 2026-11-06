import { getSessionStorage, SAML_CODE_VERIFIER_STORAGE_KEY } from './auth-storage';
import { sanitizeAppRedirectPath } from './redirect-path.utils';

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 code verifier: 32 random bytes, base64url (43 characters). */
export function generatePkceCodeVerifier(): string {
  const bytes = new Uint8Array(32);

  globalThis.crypto.getRandomValues(bytes);

  return base64UrlEncode(bytes);
}

/** RFC 7636 S256 challenge: base64url(SHA-256(verifier)). */
export async function computePkceS256Challenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));

  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Builds the API URL that starts SAML sign-in. A fresh PKCE verifier is kept in sessionStorage so only this
 * browser tab can exchange the one-time code the API hands back (`/login/saml/callback`).
 */
export async function buildSamlLoginUrl(apiUrl: string, redirectPath?: string, tenantId?: string): Promise<string> {
  const verifier = generatePkceCodeVerifier();
  const challenge = await computePkceS256Challenge(verifier);

  getSessionStorage()?.setItem(SAML_CODE_VERIFIER_STORAGE_KEY, verifier);

  const params = new URLSearchParams({
    code_challenge: challenge,
    redirect: sanitizeAppRedirectPath(redirectPath, '/'),
  });

  // Browser navigation cannot send `X-Tenant`; multi-tenant APIs read the tenant from the query instead.
  if (tenantId?.trim()) {
    params.set('tenant', tenantId.trim());
  }

  return `${apiUrl.replace(/\/+$/, '')}/auth/saml/login?${params.toString()}`;
}

/** Redirects the browser to the API's SAML sign-in endpoint. */
export async function startSamlLogin(apiUrl: string, redirectPath?: string, tenantId?: string): Promise<void> {
  const url = await buildSamlLoginUrl(apiUrl, redirectPath, tenantId);

  globalThis.location.assign(url);
}

/** Reads and removes the pending SAML PKCE verifier (single use). */
export function takeSamlCodeVerifier(): string | null {
  const store = getSessionStorage();
  const verifier = store?.getItem(SAML_CODE_VERIFIER_STORAGE_KEY) ?? null;

  store?.removeItem(SAML_CODE_VERIFIER_STORAGE_KEY);

  return verifier;
}
