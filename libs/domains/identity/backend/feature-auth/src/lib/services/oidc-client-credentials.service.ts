import { createHash } from 'node:crypto';
import type { LookupFunction } from 'node:net';

import {
  assertProviderUrl,
  createPinnedFetch,
  oidcDiscoveryUrlForIssuer,
  oidcFetchJson,
  OidcProviderMetadataCache,
} from '@forepath/identity/backend';
import type { OidcFetch } from '@forepath/identity/backend';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { OIDC_CLIENT_CREDENTIALS_FETCH } from '../constants/oidc.constants';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface OidcClientCredentialsRequest {
  /** Issuer of the OpenID provider (discovery at `<issuer>/.well-known/openid-configuration`). */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Optional space separated scopes (some providers require e.g. `api://…/.default`). */
  scope?: string;
  /**
   * Optional SSRF policy for provider URLs (discovery + token endpoint), e.g. for issuers supplied per client.
   * Throw to reject a URL.
   */
  assertUrlAllowed?: (url: string) => Promise<void> | void;
  /**
   * Optional DNS lookup used for the actual connections (discovery + token endpoint). Use a lookup that rejects
   * private addresses for user-supplied issuers so the validated address is the connected one (no DNS rebinding).
   */
  lookup?: LookupFunction;
}

const DEFAULT_TOKEN_LIFETIME_SECONDS = 60;
const EXPIRY_SAFETY_MARGIN_SECONDS = 30;

/**
 * OAuth 2.0 client credentials grant against any OpenID provider (service-to-service calls, e.g. the
 * Agenstra controller calling an agent-manager running `AUTHENTICATION_METHOD=oidc`).
 * The token endpoint is discovered from the issuer; tokens are cached until shortly before expiry.
 */
@Injectable()
export class OidcClientCredentialsService {
  private readonly logger = new Logger(OidcClientCredentialsService.name);
  private readonly tokenCache = new Map<string, CachedToken>();
  private readonly fetchImpl: OidcFetch;
  private readonly metadataCache: OidcProviderMetadataCache;

  constructor(@Optional() @Inject(OIDC_CLIENT_CREDENTIALS_FETCH) fetchImpl?: OidcFetch | null) {
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.metadataCache = new OidcProviderMetadataCache(this.fetchImpl);
  }

  async getAccessToken(request: OidcClientCredentialsRequest): Promise<string> {
    const { issuer, clientId, clientSecret, scope } = request;

    assertProviderUrl(issuer, 'OIDC issuer');

    const cacheKey = this.cacheKey(issuer, clientId, clientSecret, scope);
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const discoveryUrl = oidcDiscoveryUrlForIssuer(issuer);

    try {
      await request.assertUrlAllowed?.(discoveryUrl);

      // Pinned connections for untrusted issuers: no shared cache, every hop resolves through `lookup`.
      const fetchImpl = request.lookup ? createPinnedFetch(request.lookup) : this.fetchImpl;
      const metadataCache = request.lookup ? new OidcProviderMetadataCache(fetchImpl) : this.metadataCache;
      const metadata = await metadataCache.get(discoveryUrl, issuer);

      if (!metadata.token_endpoint) {
        throw new Error('OpenID provider advertises no token_endpoint');
      }

      await request.assertUrlAllowed?.(metadata.token_endpoint);

      const supported = metadata.token_endpoint_auth_methods_supported;
      const useBasic =
        !supported || supported.includes('client_secret_basic') || !supported.includes('client_secret_post');
      const form = new URLSearchParams({ grant_type: 'client_credentials' });
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };

      if (scope?.trim()) {
        form.set('scope', scope.trim());
      }

      if (useBasic) {
        headers.Authorization = `Basic ${Buffer.from(
          `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
        ).toString('base64')}`;
      } else {
        form.set('client_id', clientId);
        form.set('client_secret', clientSecret);
      }

      const response = await oidcFetchJson<TokenResponse>(fetchImpl, metadata.token_endpoint, {
        method: 'POST',
        headers,
        body: form.toString(),
      });

      if (!response?.access_token || typeof response.access_token !== 'string') {
        throw new Error('OpenID provider did not return an access token');
      }

      const lifetime =
        typeof response.expires_in === 'number' && response.expires_in > 0
          ? response.expires_in
          : DEFAULT_TOKEN_LIFETIME_SECONDS;
      const ttlSeconds = Math.max(lifetime - EXPIRY_SAFETY_MARGIN_SECONDS, 0);

      if (ttlSeconds > 0) {
        this.tokenCache.set(cacheKey, { token: response.access_token, expiresAt: Date.now() + ttlSeconds * 1000 });
      }

      this.logger.debug(`Obtained client credentials token for client ${clientId}`);

      return response.access_token;
    } catch (error) {
      const message = (error as Error).message || 'Unknown error';

      this.logger.error(`Failed to obtain client credentials token for client ${clientId}: ${message}`);
      throw new Error(`Failed to authenticate with the OpenID provider: ${message}`);
    }
  }

  /** Drops cached tokens of a client (all scopes / secrets). */
  clearCache(issuer: string, clientId: string): void {
    const prefix = `${issuer}\n${clientId}\n`;

    for (const key of [...this.tokenCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.tokenCache.delete(key);
      }
    }
  }

  clearAllCache(): void {
    this.tokenCache.clear();
  }

  private cacheKey(issuer: string, clientId: string, clientSecret: string, scope?: string): string {
    // Secret hash in the key: rotating a secret can never return a token minted with the old one.
    const secretHash = createHash('sha256').update(clientSecret, 'utf8').digest('hex').slice(0, 16);

    return `${issuer}\n${clientId}\n${scope ?? ''}\n${secretHash}`;
  }
}
