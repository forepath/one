import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AppAuthorizationErrorCode, AppAuthorizationStatus } from '../constants/app.constants';

/**
 * Scope math of the app grant flow (all sets are product-catalog scopes):
 *
 * - requested   = app scopes that are still in the catalog
 * - grantable   = requested ∩ what the user's current role may grant (admin scopes only for admins)
 * - effective   = consented ∩ requested ∩ role catalog (shrinks immediately on app scope removal or demotion)
 * - needs reauth when some grantable scope is not consented (app gained a scope, or the user can now grant more)
 */
export interface AppScopeEvaluation {
  requested: string[];
  grantable: string[];
  ungrantable: string[];
  effective: string[];
  needsReauthorization: boolean;
}

export function evaluateAppScopes(input: {
  appScopes: readonly string[];
  catalog: readonly string[];
  roleCatalog: readonly string[];
  consentedScopes?: readonly string[] | null;
}): AppScopeEvaluation {
  const catalog = new Set(input.catalog);
  const roleCatalog = new Set(input.roleCatalog);
  const consented = new Set(input.consentedScopes ?? []);
  const requested = [...new Set(input.appScopes)].filter((scope) => catalog.has(scope));
  const grantable = requested.filter((scope) => roleCatalog.has(scope));
  const ungrantable = requested.filter((scope) => !roleCatalog.has(scope));
  const effective = grantable.filter((scope) => consented.has(scope));
  const needsReauthorization = grantable.some((scope) => !consented.has(scope));

  return { requested, grantable, ungrantable, effective, needsReauthorization };
}

/** Order-insensitive equality of two scope lists. */
export function sameScopeSet(a: readonly string[], b: readonly string[] | undefined | null): boolean {
  const left = new Set(a);
  const right = new Set(b ?? []);

  return left.size === right.size && [...left].every((scope) => right.has(scope));
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validate and normalize an app return URL: absolute http(s), https unless loopback,
 * no credentials and no fragment (parameters are appended as query).
 * Returns `null` when the URL is not acceptable.
 */
export function normalizeAppReturnUrl(raw: string): string | null {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }

  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  if (url.username || url.password || url.hash) {
    return null;
  }

  return url.toString();
}

export interface AppReturnParams {
  status: AppAuthorizationStatus;
  appId: string;
  state?: string;
  code?: string;
  error?: AppAuthorizationErrorCode;
  errorDescription?: string;
}

/** Build the redirect to the app's registered return URL (never a caller-supplied URL). */
export function buildAppReturnUrl(returnUrl: string, params: AppReturnParams): string {
  const url = new URL(returnUrl);

  url.searchParams.set('status', params.status);
  url.searchParams.set('app_id', params.appId);

  if (params.code) {
    url.searchParams.set('code', params.code);
  }

  if (params.error) {
    url.searchParams.set('error', params.error);
  }

  if (params.errorDescription) {
    url.searchParams.set('error_description', params.errorDescription);
  }

  if (params.state !== undefined && params.state !== '') {
    url.searchParams.set('state', params.state);
  }

  return url.toString();
}

/** `<prefix><43 base64url chars>` from 32 random bytes. */
export function generateAppCredential(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

/** SHA-256 hex for high-entropy credentials (codes, refresh tokens) that need direct lookup. */
export function hashAppCredential(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** PKCE S256: base64url(SHA-256(verifier)) === challenge (constant time). */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(createHash('sha256').update(verifier, 'ascii').digest('base64url'));
  const expected = Buffer.from(challenge);

  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
