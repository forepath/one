import { generateKeyPairSync, verify } from 'node:crypto';

import {
  fleetBodyHash,
  fleetClaimUrl,
  fleetKeyFingerprint,
  isClaimableContentType,
  mintFleetClaim,
} from './fleet-identity-claims';

describe('fleet identity claims (3.24)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const NOW = new Date('2026-10-26T12:00:00.000Z');

  it('mints an EdDSA JWS bound to the cluster, the request and the body, valid for 60 s', () => {
    const body = Buffer.from('{"confirm":true}');
    const token = mintFleetClaim(
      privateKey,
      'k1',
      {
        issuer: 'fleet-1',
        audience: 'cluster-1',
        subject: 'u1',
        email: 'alice@example.com',
        emailVerified: true,
        role: 'operator',
        projects: { shop: 'admin' },
        method: 'post',
        url: fleetClaimUrl('plans/p1/approve', ''),
        body,
      },
      NOW,
    );
    const [header, payload, signature] = token.split('.');

    expect(verify(null, Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(
      true,
    );
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: 'k1' });

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());

    expect(claims).toMatchObject({
      iss: 'fleet-1',
      aud: 'cluster-1',
      sub: 'u1',
      email: 'alice@example.com',
      email_verified: true,
      role: 'operator',
      prj: { shop: 'admin' },
      htm: 'POST',
      htu: '/api/plans/p1/approve',
      bh: fleetBodyHash(body),
    });
    expect(claims.exp - claims.iat).toBe(60);
    expect(claims.jti).toMatch(/^[A-Za-z0-9_-]{24}$/);
    // Every claim has its own nonce.
    expect(
      mintFleetClaim(privateKey, 'k1', {
        issuer: 'f',
        audience: 'c',
        subject: 'u',
        role: null,
        method: 'GET',
        url: '/api/x',
      }),
    ).not.toBe(
      mintFleetClaim(privateKey, 'k1', {
        issuer: 'f',
        audience: 'c',
        subject: 'u',
        role: null,
        method: 'GET',
        url: '/api/x',
      }),
    );
  });

  it('binds the URL with the forwarded query and fingerprints keys like the cluster', () => {
    expect(fleetClaimUrl('/plans', 'project=shop&limit=5')).toBe('/api/plans?project=shop&limit=5');
    expect(fleetKeyFingerprint(publicKey.export({ type: 'spki', format: 'pem' }).toString())).toMatch(
      /^SHA256:[\w-]{43}$/,
    );
  });

  it('binds only bodies the cluster parses as JSON', () => {
    expect(isClaimableContentType('application/json; charset=utf-8')).toBe(true);
    expect(isClaimableContentType('application/merge-patch+json')).toBe(true);
    expect(isClaimableContentType(undefined)).toBe(true);
    expect(isClaimableContentType('application/octet-stream')).toBe(false);
    expect(isClaimableContentType('multipart/form-data; boundary=x')).toBe(false);
  });
});
