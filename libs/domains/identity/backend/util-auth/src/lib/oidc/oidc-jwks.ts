import { createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';

import { type OidcFetch, oidcFetchJson } from './oidc-http';

interface Jwk extends JsonWebKey {
  kid?: string;
  use?: string;
  alg?: string;
  kty?: string;
  key_ops?: string[];
}

/** Key type expected for each JWS algorithm family. */
function expectedKeyType(alg: string): string | null {
  if (alg.startsWith('RS') || alg.startsWith('PS')) {
    return 'RSA';
  }

  if (alg.startsWith('ES')) {
    return 'EC';
  }

  return null;
}

function isSigningKey(jwk: Jwk): boolean {
  if (jwk.use && jwk.use !== 'sig') {
    return false;
  }

  if (Array.isArray(jwk.key_ops) && !jwk.key_ops.includes('verify')) {
    return false;
  }

  // Never import private / symmetric material from a JWKS.
  return jwk.kty === 'RSA' || jwk.kty === 'EC';
}

/**
 * Remote JWKS with an in-memory cache. Unknown `kid`s trigger a refetch (key rotation), rate limited by
 * `minRefreshIntervalMs` so random `kid`s cannot be used to hammer the provider.
 */
export class OidcRemoteJwks {
  private keys: Jwk[] = [];
  private fetchedAt = 0;
  /** Last fetch attempt (success or failure); failures are retried no more often than `minRefreshIntervalMs`. */
  private attemptedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly fetchImpl: OidcFetch,
    private readonly jwksUri: string,
    private readonly maxAgeMs = 10 * 60 * 1000,
    private readonly minRefreshIntervalMs = 30 * 1000,
  ) {}

  async getKey(kid: string | undefined, alg: string): Promise<KeyObject> {
    const kty = expectedKeyType(alg);

    if (!kty) {
      throw new Error(`Unsupported JWS algorithm "${alg}"`);
    }

    const now = Date.now();

    if ((this.fetchedAt === 0 || now - this.fetchedAt > this.maxAgeMs) && this.mayAttempt(now)) {
      await this.refresh();
    }

    let jwk = this.select(kid, alg, kty);

    if (!jwk && this.mayAttempt(Date.now())) {
      await this.refresh();
      jwk = this.select(kid, alg, kty);
    }

    if (!jwk) {
      throw new Error('No matching signing key found in JWKS');
    }

    const { kid: _kid, use: _use, alg: _alg, key_ops: _ops, ...keyMaterial } = jwk;

    return createPublicKey({ key: keyMaterial as JsonWebKey, format: 'jwk' });
  }

  private select(kid: string | undefined, alg: string, kty: string): Jwk | undefined {
    const candidates = this.keys.filter(
      (key) => isSigningKey(key) && key.kty === kty && (!key.alg || key.alg === alg) && (kid ? key.kid === kid : true),
    );

    // Without a `kid` only an unambiguous key may be used.
    if (!kid && candidates.length !== 1) {
      return undefined;
    }

    return candidates[0];
  }

  private mayAttempt(now: number): boolean {
    return this.attemptedAt === 0 || now - this.attemptedAt >= this.minRefreshIntervalMs;
  }

  private async refresh(): Promise<void> {
    if (!this.inflight) {
      this.attemptedAt = Date.now();
      this.inflight = oidcFetchJson<{ keys?: unknown }>(this.fetchImpl, this.jwksUri)
        .then((body) => {
          if (!body || !Array.isArray(body.keys)) {
            throw new Error('JWKS response has no "keys" array');
          }

          this.keys = body.keys.filter((key): key is Jwk => !!key && typeof key === 'object');
          this.fetchedAt = Date.now();
        })
        .finally(() => {
          this.inflight = null;
        });
    }

    await this.inflight;
  }
}
