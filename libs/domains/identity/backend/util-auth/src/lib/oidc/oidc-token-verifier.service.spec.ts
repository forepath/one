import { generateKeyPairSync, type KeyObject } from 'node:crypto';

import { UnauthorizedException } from '@nestjs/common';
import { sign, type SignOptions } from 'jsonwebtoken';

import type { OidcFetch } from './oidc-http';
import { OidcTokenVerifier } from './oidc-token-verifier.service';

const ISSUER = 'https://idp.example.com/realms/test';
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const JWKS_URI = `${ISSUER}/protocol/openid-connect/certs`;
const INTROSPECTION = `${ISSUER}/protocol/openid-connect/token/introspect`;

interface KeyPair {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

function rsaKey(kid: string): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' } };
}

function ecKey(kid: string): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'ES256' } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('OidcTokenVerifier', () => {
  const envBackup = { ...process.env };
  let keys: KeyPair[];
  let introspectionActive: boolean;
  let fetchMock: jest.Mock;
  let verifier: OidcTokenVerifier;
  let rsa: KeyPair;

  function token(payload: Record<string, unknown> = {}, options: SignOptions = {}, key: KeyPair = rsa): string {
    return sign({ sub: 'user-1', typ: 'Bearer', email: 'u@example.com', ...payload }, key.privateKey, {
      algorithm: key.jwk.alg as SignOptions['algorithm'],
      keyid: key.kid,
      issuer: ISSUER,
      expiresIn: 300,
      ...options,
    });
  }

  beforeEach(() => {
    process.env = { ...envBackup };
    process.env.OIDC_ISSUER = ISSUER;
    process.env.OIDC_CLIENT_ID = 'api';
    process.env.OIDC_CLIENT_SECRET = 'api-secret';
    delete process.env.OIDC_TOKEN_VALIDATION;
    delete process.env.OIDC_AUDIENCE;
    delete process.env.OIDC_AUTHORIZED_PARTIES;
    delete process.env.OIDC_DISCOVERY_URL;
    delete process.env.OIDC_ALLOWED_ALGORITHMS;

    rsa = rsaKey('rsa-1');
    keys = [rsa];
    introspectionActive = true;
    fetchMock = jest.fn(async (url: string) => {
      if (url === DISCOVERY) {
        return json({ issuer: ISSUER, jwks_uri: JWKS_URI, introspection_endpoint: INTROSPECTION });
      }

      if (url === JWKS_URI) {
        return json({ keys: keys.map((k) => k.jwk) });
      }

      if (url === INTROSPECTION) {
        return json({ active: introspectionActive });
      }

      return json({}, 404);
    });
    verifier = new OidcTokenVerifier(fetchMock as unknown as OidcFetch);
  });

  afterAll(() => {
    process.env = envBackup;
  });

  it('accepts a valid RS256 access token and introspects it (ONLINE default)', async () => {
    const claims = await verifier.verifyAccessToken(token());

    expect(claims.sub).toBe('user-1');
    expect(verifier.getEmail(claims)).toBe('u@example.com');

    const introspectionCall = fetchMock.mock.calls.find(([url]) => url === INTROSPECTION);

    expect(introspectionCall).toBeDefined();
    expect((introspectionCall![1] as RequestInit).headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('api:api-secret').toString('base64')}`,
    });
  });

  it('accepts ES256 tokens', async () => {
    const ec = ecKey('ec-1');

    keys = [rsa, ec];

    await expect(verifier.verifyAccessToken(token({}, {}, ec))).resolves.toMatchObject({ sub: 'user-1' });
  });

  it('rejects tokens the provider reports inactive (revoked session)', async () => {
    introspectionActive = false;

    await expect(verifier.verifyAccessToken(token())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not introspect in OFFLINE mode', async () => {
    process.env.OIDC_TOKEN_VALIDATION = 'OFFLINE';
    verifier = new OidcTokenVerifier(fetchMock as unknown as OidcFetch);
    introspectionActive = false;

    await expect(verifier.verifyAccessToken(token())).resolves.toMatchObject({ sub: 'user-1' });
    expect(fetchMock.mock.calls.some(([url]) => url === INTROSPECTION)).toBe(false);
  });

  it('rejects HS256 tokens (algorithm confusion with the public key or the app JWT secret)', async () => {
    const forged = sign({ sub: 'user-1', typ: 'Bearer' }, 'app-jwt-secret', {
      algorithm: 'HS256',
      keyid: rsa.kid,
      issuer: ISSUER,
      expiresIn: 300,
    });

    await expect(verifier.verifyAccessToken(forged)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects alg "none"', async () => {
    const unsigned = sign({ sub: 'user-1', typ: 'Bearer', iss: ISSUER }, '', { algorithm: 'none' });

    await expect(verifier.verifyAccessToken(unsigned)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects tokens signed by an unknown key', async () => {
    const attacker = rsaKey('rsa-1');

    await expect(verifier.verifyAccessToken(token({}, {}, attacker))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a foreign issuer', async () => {
    await expect(verifier.verifyAccessToken(token({}, { issuer: 'https://evil.example.com' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects expired tokens', async () => {
    const expired = token({}, { expiresIn: -10 });

    await expect(verifier.verifyAccessToken(expired)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects ID tokens and refresh tokens via the typ claim', async () => {
    await expect(verifier.verifyAccessToken(token({ typ: 'ID' }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verifyAccessToken(token({ typ: 'Refresh' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects ID tokens of providers without a typ claim (at_hash / c_hash markers)', async () => {
    await expect(verifier.verifyAccessToken(token({ typ: undefined, at_hash: 'x' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(verifier.verifyAccessToken(token({ typ: undefined, c_hash: 'x' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('fails closed on oversized provider responses without buffering them', async () => {
    fetchMock.mockImplementation(async () => new Response('x'.repeat(600 * 1024), { status: 200 }));

    await expect(verifier.verifyAccessToken(token())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not hammer an unreachable JWKS endpoint (failure backoff)', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === DISCOVERY
        ? json({ issuer: ISSUER, jwks_uri: JWKS_URI, introspection_endpoint: INTROSPECTION })
        : json({ error: 'down' }, 503),
    );

    await expect(verifier.verifyAccessToken(token())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verifyAccessToken(token())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verifyAccessToken(token())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetchMock.mock.calls.filter(([url]) => url === JWKS_URI)).toHaveLength(1);
  });

  it('validates the configuration at boot in oidc mode', () => {
    process.env.AUTHENTICATION_METHOD = 'oidc';
    delete process.env.OIDC_ISSUER;

    try {
      expect(() => new OidcTokenVerifier(fetchMock as unknown as OidcFetch).onModuleInit()).toThrow(/OIDC_ISSUER/);
    } finally {
      delete process.env.AUTHENTICATION_METHOD;
    }
  });

  it('rejects tokens without sub', async () => {
    await expect(verifier.verifyAccessToken(token({ sub: undefined }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('enforces OIDC_AUDIENCE', async () => {
    process.env.OIDC_AUDIENCE = 'agenstra-api, other-api';
    verifier = new OidcTokenVerifier(fetchMock as unknown as OidcFetch);

    await expect(verifier.verifyAccessToken(token({ aud: 'account' }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verifyAccessToken(token({ aud: ['account', 'other-api'] }))).resolves.toBeDefined();
  });

  it('enforces OIDC_AUTHORIZED_PARTIES (azp)', async () => {
    process.env.OIDC_AUTHORIZED_PARTIES = 'controller-client';
    verifier = new OidcTokenVerifier(fetchMock as unknown as OidcFetch);

    await expect(verifier.verifyAccessToken(token({ azp: 'console' }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verifyAccessToken(token({}))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verifyAccessToken(token({ azp: 'controller-client' }))).resolves.toBeDefined();
  });

  it('refetches the JWKS on an unknown kid (key rotation)', async () => {
    await verifier.verifyAccessToken(token());

    const rotated = rsaKey('rsa-2');

    keys = [rotated];
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);

    try {
      await expect(verifier.verifyAccessToken(token({}, {}, rotated))).resolves.toBeDefined();
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('rate limits JWKS refetches for unknown kids', async () => {
    await verifier.verifyAccessToken(token());

    const jwksCalls = () => fetchMock.mock.calls.filter(([url]) => url === JWKS_URI).length;
    const before = jwksCalls();
    const unknown = rsaKey('random-kid');

    await expect(verifier.verifyAccessToken(token({}, {}, unknown))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verifyAccessToken(token({}, {}, unknown))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwksCalls()).toBe(before);
  });

  it('rejects a discovery document for another issuer', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === DISCOVERY ? json({ issuer: 'https://evil.example.com', jwks_uri: JWKS_URI }) : json({ keys: [rsa.jwk] }),
    );

    await expect(verifier.verifyAccessToken(token())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when the provider is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(verifier.verifyAccessToken(token())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects garbage', async () => {
    await expect(verifier.verifyAccessToken('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
