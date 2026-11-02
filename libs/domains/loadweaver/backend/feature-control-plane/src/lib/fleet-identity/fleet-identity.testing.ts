import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';

import { base64url, fleetBodyHash, type FleetIdentityClaims } from './fleet-identity.utils';

/** Test helper: an Ed25519 key pair with its SPKI PEM, like a fleet's signing key. */
export function testFleetKey(): { privateKey: KeyObject; publicKey: KeyObject; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  return { privateKey, publicKey, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

/** Test helper: a compact JWS like the fleet mints it. */
export function mintTestClaim(
  privateKey: KeyObject,
  overrides: Partial<FleetIdentityClaims> & { kid?: string; body?: Buffer } = {},
  now = new Date(),
): string {
  const { kid = 'k1', body, ...rest } = overrides;
  const iat = Math.floor(now.getTime() / 1000);
  const claims: FleetIdentityClaims = {
    iss: 'fleet-test',
    aud: 'cluster-1',
    sub: 'u1',
    email: 'alice@example.com',
    email_verified: true,
    role: 'admin',
    prj: {},
    htm: 'POST',
    htu: '/api/plans/p1/approve',
    bh: fleetBodyHash(body),
    iat,
    exp: iat + 60,
    jti: randomUUID().replace(/-/g, ''),
    ...rest,
  };
  const input = `${base64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid }))}.${base64url(JSON.stringify(claims))}`;

  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
}
