import { type OidcFetch, oidcFetchJson } from './oidc-http';
import { assertProviderUrl } from './oidc.config';

/** Subset of OpenID Provider Metadata used by this library. */
export interface OidcProviderMetadata {
  issuer: string;
  jwks_uri: string;
  token_endpoint?: string;
  introspection_endpoint?: string;
  authorization_endpoint?: string;
  end_session_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
  introspection_endpoint_auth_methods_supported?: string[];
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Fetches and validates an OpenID provider discovery document.
 * The document's `issuer` must equal the expected issuer (OIDC Discovery §4.3) so a hijacked
 * discovery endpoint cannot redirect key material for another issuer.
 */
export async function fetchOidcProviderMetadata(
  fetchImpl: OidcFetch,
  discoveryUrl: string,
  expectedIssuer: string,
): Promise<OidcProviderMetadata> {
  const metadata = await oidcFetchJson<Partial<OidcProviderMetadata>>(fetchImpl, discoveryUrl);

  if (!metadata || typeof metadata !== 'object' || typeof metadata.issuer !== 'string') {
    throw new Error('OIDC discovery document is missing "issuer"');
  }

  if (normalizeIssuer(metadata.issuer) !== normalizeIssuer(expectedIssuer)) {
    throw new Error(`OIDC discovery issuer "${metadata.issuer}" does not match expected issuer "${expectedIssuer}"`);
  }

  if (typeof metadata.jwks_uri !== 'string') {
    throw new Error('OIDC discovery document is missing "jwks_uri"');
  }

  assertProviderUrl(metadata.jwks_uri, 'jwks_uri');

  for (const key of ['token_endpoint', 'introspection_endpoint'] as const) {
    const value = metadata[key];

    if (value !== undefined) {
      if (typeof value !== 'string') {
        throw new Error(`OIDC discovery "${key}" must be a string`);
      }

      assertProviderUrl(value, key);
    }
  }

  return metadata as OidcProviderMetadata;
}

/** Caches provider metadata per discovery URL (refreshed after `ttlMs`; failures are not cached). */
export class OidcProviderMetadataCache {
  private readonly entries = new Map<string, { metadata: OidcProviderMetadata; fetchedAt: number }>();
  private readonly inflight = new Map<string, Promise<OidcProviderMetadata>>();

  constructor(
    private readonly fetchImpl: OidcFetch,
    private readonly ttlMs = 60 * 60 * 1000,
  ) {}

  async get(discoveryUrl: string, expectedIssuer: string): Promise<OidcProviderMetadata> {
    const key = `${discoveryUrl}\n${expectedIssuer}`;
    const cached = this.entries.get(key);

    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached.metadata;
    }

    const pending = this.inflight.get(key);

    if (pending) {
      return pending;
    }

    const request = fetchOidcProviderMetadata(this.fetchImpl, discoveryUrl, expectedIssuer)
      .then((metadata) => {
        this.entries.set(key, { metadata, fetchedAt: Date.now() });

        return metadata;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, request);

    return request;
  }

  clear(): void {
    this.entries.clear();
  }
}
