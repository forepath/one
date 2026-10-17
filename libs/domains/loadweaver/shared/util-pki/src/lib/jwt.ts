import { createPrivateKey, createPublicKey, randomUUID, sign, verify, X509Certificate } from 'node:crypto';

/**
 * ES256 JSON Web Tokens with an x5c certificate chain, the format CNCF Distribution's token authentication accepts
 * (3.22): the registry trusts the cluster CA, the control plane signs with a short-lived CA-issued key.
 */

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function pemToDer(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''), 'base64');
}

export interface JwtClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  [claim: string]: unknown;
}

export function signJwtEs256(
  claims: Omit<JwtClaims, 'jti'> & { jti?: string },
  privateKeyPem: string,
  certificatePem: string,
): string {
  const header = { alg: 'ES256', typ: 'JWT', x5c: [pemToDer(certificatePem).toString('base64')] };
  const body = { ...claims, jti: claims.jti ?? randomUUID() };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  // JOSE wants the raw r || s signature, not DER.
  const signature = sign('sha256', Buffer.from(input), {
    key: createPrivateKey(privateKeyPem),
    dsaEncoding: 'ieee-p1363',
  });

  return `${input}.${base64url(signature)}`;
}

/** Verifies signature and lifetime against the leaf certificate in `x5c` (chain checks are the verifier's job). */
export function verifyJwtEs256(
  token: string,
  now = Date.now(),
): { header: { x5c: string[] }; claims: JwtClaims } | null {
  const [h, b, s] = token.split('.');

  if (!h || !b || !s) return null;

  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg: string; x5c?: string[] };
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString()) as JwtClaims;

    if (header.alg !== 'ES256' || !header.x5c?.[0]) return null;

    const key = createPublicKey(
      new X509Certificate(Buffer.from(header.x5c[0], 'base64')).publicKey.export({ format: 'pem', type: 'spki' }),
    );
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${b}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    );
    const seconds = Math.floor(now / 1000);

    return ok && claims.exp > seconds && claims.nbf <= seconds ? { header: { x5c: header.x5c }, claims } : null;
  } catch {
    return null;
  }
}
