/** How bearer tokens are validated in `oidc` mode. */
export type OidcTokenValidation = 'ONLINE' | 'OFFLINE';

/** Asymmetric JWS algorithms accepted for OIDC access tokens (never HS* / none). */
export const OIDC_ASYMMETRIC_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
] as const;

export type OidcAlgorithm = (typeof OIDC_ASYMMETRIC_ALGORITHMS)[number];

export interface OidcResourceServerConfig {
  /** Expected `iss` (exact match) and base for discovery. */
  issuer: string;
  /** OpenID provider discovery document URL (defaults to `<issuer>/.well-known/openid-configuration`). */
  discoveryUrl: string;
  /** Confidential client of this API; used for token introspection (ONLINE validation). */
  clientId?: string;
  clientSecret?: string;
  /** When non-empty, `aud` must contain at least one entry. */
  audiences: string[];
  /** When non-empty, `azp` (authorized party) must be one of these client ids. */
  authorizedParties: string[];
  /** ONLINE = signature + RFC 7662 introspection (`active`), OFFLINE = signature/claims only. */
  tokenValidation: OidcTokenValidation;
  algorithms: OidcAlgorithm[];
  /** Claim holding the user's email address (default `email`). */
  emailClaim: string;
  /** Allowed clock skew in seconds for `exp` / `nbf` / `iat`. */
  clockToleranceSeconds: number;
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Throws when `value` is not an absolute http(s) URL. */
export function assertHttpUrl(value: string, name: string): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must use http or https`);
  }

  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials`);
  }
}

function allowInsecureProviderHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.OIDC_ALLOW_INSECURE_HTTP?.trim().toLowerCase() === 'true';
}

/**
 * {@link assertHttpUrl} plus transport security: in production, OpenID provider URLs (issuer, discovery, JWKS,
 * token and introspection endpoints) must use https unless `OIDC_ALLOW_INSECURE_HTTP=true` — a JWKS fetched over
 * plain http could be replaced by an attacker on the network path.
 */
export function assertProviderUrl(value: string, name: string, env: NodeJS.ProcessEnv = process.env): void {
  assertHttpUrl(value, name);

  if (new URL(value).protocol === 'http:' && !allowInsecureProviderHttp(env)) {
    throw new Error(`${name} must use https in production (set OIDC_ALLOW_INSECURE_HTTP=true to allow http)`);
  }
}

/** Builds the default discovery URL for an issuer. */
export function oidcDiscoveryUrlForIssuer(issuer: string): string {
  return `${stripTrailingSlash(issuer)}/.well-known/openid-configuration`;
}

/**
 * Reads the OIDC resource-server configuration (`AUTHENTICATION_METHOD=oidc`) from the environment.
 * Fails fast on missing / unsafe settings so a misconfigured API never starts.
 */
export function readOidcResourceServerConfig(env: NodeJS.ProcessEnv = process.env): OidcResourceServerConfig {
  const issuer = env.OIDC_ISSUER?.trim();

  if (!issuer) {
    throw new Error('OIDC_ISSUER must be set when AUTHENTICATION_METHOD=oidc');
  }

  assertProviderUrl(issuer, 'OIDC_ISSUER', env);

  const discoveryUrl = env.OIDC_DISCOVERY_URL?.trim() || oidcDiscoveryUrlForIssuer(issuer);

  assertProviderUrl(discoveryUrl, 'OIDC_DISCOVERY_URL', env);

  const rawValidation = (env.OIDC_TOKEN_VALIDATION?.trim() || 'ONLINE').toUpperCase();

  if (rawValidation !== 'ONLINE' && rawValidation !== 'OFFLINE') {
    throw new Error('OIDC_TOKEN_VALIDATION must be ONLINE or OFFLINE');
  }

  const clientId = env.OIDC_CLIENT_ID?.trim() || undefined;
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim() || undefined;

  if (rawValidation === 'ONLINE' && (!clientId || !clientSecret)) {
    throw new Error(
      'OIDC_TOKEN_VALIDATION=ONLINE (default) requires OIDC_CLIENT_ID and OIDC_CLIENT_SECRET for token introspection; set them or use OIDC_TOKEN_VALIDATION=OFFLINE',
    );
  }

  const configuredAlgorithms = csv(env.OIDC_ALLOWED_ALGORITHMS).map((alg) => alg.toUpperCase());
  const algorithms = (
    configuredAlgorithms.length > 0 ? configuredAlgorithms : [...OIDC_ASYMMETRIC_ALGORITHMS]
  ) as OidcAlgorithm[];

  for (const alg of algorithms) {
    if (!(OIDC_ASYMMETRIC_ALGORITHMS as readonly string[]).includes(alg)) {
      throw new Error(`OIDC_ALLOWED_ALGORITHMS contains unsupported algorithm "${alg}" (asymmetric algorithms only)`);
    }
  }

  const clockTolerance = parseInt(env.OIDC_CLOCK_TOLERANCE_SECONDS ?? '0', 10);
  const audiences = csv(env.OIDC_AUDIENCE);
  const authorizedParties = csv(env.OIDC_AUTHORIZED_PARTIES);

  // Without an audience / authorized-party restriction any token of the issuer (other apps, service accounts,
  // ID tokens of some providers) would be accepted. Mandatory in production; explicit opt-out for special setups.
  if (
    audiences.length === 0 &&
    authorizedParties.length === 0 &&
    env.NODE_ENV === 'production' &&
    env.OIDC_ALLOW_UNRESTRICTED_AUDIENCE?.trim().toLowerCase() !== 'true'
  ) {
    throw new Error(
      'OIDC_AUDIENCE or OIDC_AUTHORIZED_PARTIES must be set in production so only tokens issued for this API are accepted (OIDC_ALLOW_UNRESTRICTED_AUDIENCE=true to opt out)',
    );
  }

  return {
    issuer,
    discoveryUrl,
    clientId,
    clientSecret,
    audiences,
    authorizedParties,
    tokenValidation: rawValidation,
    algorithms,
    emailClaim: env.OIDC_EMAIL_CLAIM?.trim() || 'email',
    clockToleranceSeconds: Number.isFinite(clockTolerance) ? Math.min(Math.max(clockTolerance, 0), 300) : 0,
  };
}
