import { Inject, Injectable, Logger, OnModuleInit, Optional, UnauthorizedException } from '@nestjs/common';
import { decode, verify, type Algorithm, type JwtPayload } from 'jsonwebtoken';

import { getAuthenticationMethod } from '../authentication-method';

import { type OidcFetch, oidcFetchJson } from './oidc-http';
import { OidcRemoteJwks } from './oidc-jwks';
import { type OidcProviderMetadata, OidcProviderMetadataCache } from './oidc-provider-metadata';
import { type OidcResourceServerConfig, readOidcResourceServerConfig } from './oidc.config';

/** Validated OIDC access token claims (raw payload; provider specific claims are kept). */
export interface OidcAccessTokenClaims extends JwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  azp?: string;
  typ?: string;
  scope?: string;
  [claim: string]: unknown;
}

/** Injection token for a custom fetch implementation (tests). */
export const OIDC_FETCH = 'IDENTITY_OIDC_FETCH';

/**
 * Provider-agnostic OIDC access token validation for APIs (`AUTHENTICATION_METHOD=oidc`).
 *
 * Every token is verified locally: JWKS signature (asymmetric algorithms only), exact `iss`, `exp`/`nbf`,
 * optional `aud` / `azp` allowlists and the Keycloak-style `typ` claim (ID / refresh tokens are rejected).
 * With `OIDC_TOKEN_VALIDATION=ONLINE` (default) the token must additionally be `active` at the provider's
 * RFC 7662 introspection endpoint, so revoked sessions stop working immediately.
 */
@Injectable()
export class OidcTokenVerifier implements OnModuleInit {
  private readonly logger = new Logger(OidcTokenVerifier.name);
  private config: OidcResourceServerConfig | null = null;
  private readonly metadataCache: OidcProviderMetadataCache;
  private jwks: OidcRemoteJwks | null = null;
  private jwksUri: string | null = null;

  private readonly fetchImpl: OidcFetch;

  constructor(@Optional() @Inject(OIDC_FETCH) fetchImpl?: OidcFetch | null) {
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.metadataCache = new OidcProviderMetadataCache(this.fetchImpl);
  }

  /** Validate the configuration at boot so a misconfigured API fails to start instead of answering 401s. */
  onModuleInit(): void {
    if (getAuthenticationMethod() === 'oidc') {
      this.getConfig();
    }
  }

  /** Lazily read configuration so modules can be imported in other modes without OIDC env vars. */
  getConfig(): OidcResourceServerConfig {
    if (!this.config) {
      this.config = readOidcResourceServerConfig();

      if (this.config.audiences.length === 0 && this.config.authorizedParties.length === 0) {
        this.logger.warn(
          'OIDC_AUDIENCE and OIDC_AUTHORIZED_PARTIES are unset: any valid access token of the issuer is accepted. Restrict tokens to this API where the provider supports it.',
        );
      }
    }

    return this.config;
  }

  /** Verifies an access token and returns its claims; throws {@link UnauthorizedException} otherwise. */
  async verifyAccessToken(token: string): Promise<OidcAccessTokenClaims> {
    const config = this.getConfig();
    const decoded = decode(token, { complete: true });

    if (!decoded || typeof decoded === 'string' || typeof decoded.payload === 'string') {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const alg = decoded.header.alg;

    if (!alg || !(config.algorithms as string[]).includes(alg)) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    let metadata: OidcProviderMetadata;
    let claims: OidcAccessTokenClaims;

    try {
      metadata = await this.metadataCache.get(config.discoveryUrl, config.issuer);
      const key = await this.getJwks(metadata).getKey(decoded.header.kid, alg);

      claims = verify(token, key, {
        algorithms: [alg as Algorithm],
        issuer: config.issuer,
        ...(config.audiences.length > 0 ? { audience: config.audiences as [string, ...string[]] } : {}),
        clockTolerance: config.clockToleranceSeconds,
      }) as OidcAccessTokenClaims;
    } catch (error) {
      this.logger.debug(`OIDC token rejected: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    this.assertAccessTokenClaims(claims, config);

    if (config.tokenValidation === 'ONLINE') {
      await this.assertActive(token, metadata, config);
    }

    return claims;
  }

  /** Reads the configured email claim. */
  getEmail(claims: OidcAccessTokenClaims): string | undefined {
    const value = claims[this.getConfig().emailClaim];

    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  private assertAccessTokenClaims(claims: OidcAccessTokenClaims, config: OidcResourceServerConfig): void {
    if (typeof claims.sub !== 'string' || claims.sub.trim().length === 0) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (typeof claims.exp !== 'number') {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Keycloak (and others) mark token kinds via `typ`; only access tokens may authenticate API calls.
    if (claims.typ !== undefined && String(claims.typ).toLowerCase() !== 'bearer') {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // ID tokens of providers without a `typ` claim: `at_hash` / `c_hash` only ever appear in ID tokens (OIDC Core).
    if (claims.at_hash !== undefined || claims.c_hash !== undefined) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (config.authorizedParties.length > 0) {
      if (typeof claims.azp !== 'string' || !config.authorizedParties.includes(claims.azp)) {
        throw new UnauthorizedException('Invalid or expired token');
      }
    }
  }

  private async assertActive(
    token: string,
    metadata: OidcProviderMetadata,
    config: OidcResourceServerConfig,
  ): Promise<void> {
    if (!metadata.introspection_endpoint) {
      this.logger.error('OIDC_TOKEN_VALIDATION=ONLINE but the provider advertises no introspection_endpoint');
      throw new UnauthorizedException('Invalid or expired token');
    }

    const supported = metadata.introspection_endpoint_auth_methods_supported;
    const useBasic = !supported || supported.includes('client_secret_basic');
    const form = new URLSearchParams({ token, token_type_hint: 'access_token' });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };

    if (useBasic) {
      headers.Authorization = `Basic ${Buffer.from(
        `${encodeURIComponent(config.clientId ?? '')}:${encodeURIComponent(config.clientSecret ?? '')}`,
      ).toString('base64')}`;
    } else {
      form.set('client_id', config.clientId ?? '');
      form.set('client_secret', config.clientSecret ?? '');
    }

    let result: { active?: unknown } | undefined;

    try {
      result = await oidcFetchJson<{ active?: unknown }>(this.fetchImpl, metadata.introspection_endpoint, {
        method: 'POST',
        headers,
        body: form.toString(),
      });
    } catch (error) {
      this.logger.warn(`OIDC token introspection failed: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (result?.active !== true) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private getJwks(metadata: OidcProviderMetadata): OidcRemoteJwks {
    if (!this.jwks || this.jwksUri !== metadata.jwks_uri) {
      this.jwks = new OidcRemoteJwks(this.fetchImpl, metadata.jwks_uri);
      this.jwksUri = metadata.jwks_uri;
    }

    return this.jwks;
  }
}
