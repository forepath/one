import { createPrivateKey, randomUUID, sign, verify, X509Certificate, type KeyObject } from 'node:crypto';

import { type MtlsClientPrincipal, MtlsVerificationError, verifyClientCertificateChain } from './mtls-certificate';
import {
  MTLS_ASSERTION_CLOCK_SKEW_SECONDS,
  MTLS_ASSERTION_TYPE,
  MTLS_MAX_CHAIN_LENGTH,
  parseCertificateBundle,
  type MtlsConfig,
} from './mtls.config';

/**
 * Certificate assertions: proof of possession of a client certificate's private key at the application layer, for
 * clients that cannot present the certificate in the TLS handshake (browsers with an uploaded certificate file, or
 * any client behind a TLS-terminating reverse proxy).
 *
 * Format: a compact JWS (RFC 7515) sent as `Authorization: Certificate <jws>`:
 * - header `{ alg, typ: "cert-assertion+jwt", x5c: [leaf, ...intermediates] }` (standard base64 DER)
 * - payload `{ iat, exp, jti, aud? }`, short-lived (`exp - iat` ≤ `MTLS_ASSERTION_MAX_LIFETIME`, default 300s)
 * - signed with the leaf certificate's private key; `alg` must match the leaf key (no algorithm confusion)
 */

/** Supported JWS algorithms, one per accepted key type. */
export type MtlsAssertionAlgorithm = 'RS256' | 'ES256' | 'ES384' | 'ES512' | 'EdDSA';

/** Upper bound of a serialized assertion (header carries the certificate chain). */
export const MTLS_ASSERTION_MAX_LENGTH = 32 * 1024;

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const BASE64_DER = /^[A-Za-z0-9+/]+={0,2}$/;
const FORBIDDEN_HEADER_PARAMETERS = ['crit', 'b64', 'jku', 'jwk', 'x5u'];
const ECDSA_SIGNATURE_LENGTH: Partial<Record<MtlsAssertionAlgorithm, number>> = { ES256: 64, ES384: 96, ES512: 132 };

function fail(reason: string): never {
  throw new MtlsVerificationError(reason);
}

/** The only JWS algorithm a key may sign assertions with. */
export function getMtlsAssertionAlgorithm(publicKey: KeyObject): MtlsAssertionAlgorithm {
  switch (publicKey.asymmetricKeyType) {
    case 'rsa':
      return 'RS256';
    case 'ec':
      switch (publicKey.asymmetricKeyDetails?.namedCurve) {
        case 'prime256v1':
          return 'ES256';
        case 'secp384r1':
          return 'ES384';
        case 'secp521r1':
          return 'ES512';
      }

      break;
    case 'ed25519':
      return 'EdDSA';
  }

  return fail('unsupported key type for certificate assertions');
}

function digestFor(algorithm: MtlsAssertionAlgorithm): string | null {
  switch (algorithm) {
    case 'RS256':
    case 'ES256':
      return 'sha256';
    case 'ES384':
      return 'sha384';
    case 'ES512':
      return 'sha512';
    case 'EdDSA':
      return null;
  }
}

function decodeJsonSegment(segment: string, label: string): Record<string, unknown> {
  let value: unknown;

  try {
    value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return fail(`malformed assertion ${label}`);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(`malformed assertion ${label}`);
  }

  return value as Record<string, unknown>;
}

function isIntegerTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Verifies a certificate assertion (the credential after `Certificate `) and its certificate chain.
 *
 * @throws MtlsVerificationError when the assertion must not authenticate
 */
export function verifyMtlsAssertion(token: string, config: MtlsConfig, now: Date = new Date()): MtlsClientPrincipal {
  if (token.length > MTLS_ASSERTION_MAX_LENGTH) {
    fail('assertion too large');
  }

  const segments = token.split('.');

  if (segments.length !== 3 || !segments.every((segment) => BASE64URL_SEGMENT.test(segment))) {
    fail('malformed assertion');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = decodeJsonSegment(encodedHeader, 'header');
  const payload = decodeJsonSegment(encodedPayload, 'payload');

  if (header['typ'] !== MTLS_ASSERTION_TYPE) {
    fail('unexpected assertion type');
  }

  if (FORBIDDEN_HEADER_PARAMETERS.some((parameter) => parameter in header)) {
    fail('unsupported assertion header parameter');
  }

  const x5c = header['x5c'];

  if (
    !Array.isArray(x5c) ||
    x5c.length === 0 ||
    x5c.length > MTLS_MAX_CHAIN_LENGTH ||
    !x5c.every((entry) => typeof entry === 'string' && BASE64_DER.test(entry))
  ) {
    fail('assertion must carry the certificate chain (x5c)');
  }

  let chain: X509Certificate[];

  try {
    chain = (x5c as string[]).map((entry) => new X509Certificate(Buffer.from(entry, 'base64')));
  } catch {
    return fail('assertion certificate chain is not valid DER');
  }

  const leafKey = chain[0].publicKey;
  const algorithm = getMtlsAssertionAlgorithm(leafKey);

  if (header['alg'] !== algorithm) {
    fail('assertion algorithm does not match the certificate key');
  }

  // Claims first: cheap and independent of the key.
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const { iat, exp, nbf, aud } = payload;

  if (!isIntegerTime(iat) || !isIntegerTime(exp) || exp <= iat) {
    fail('assertion must carry integer iat < exp');
  }

  if (exp - iat > config.assertionMaxLifetimeSeconds) {
    fail('assertion lifetime exceeds the allowed maximum');
  }

  if (iat > nowSeconds + MTLS_ASSERTION_CLOCK_SKEW_SECONDS) {
    fail('assertion issued in the future');
  }

  if (exp <= nowSeconds - MTLS_ASSERTION_CLOCK_SKEW_SECONDS) {
    fail('assertion expired');
  }

  if (nbf !== undefined && (!isIntegerTime(nbf) || nbf > nowSeconds + MTLS_ASSERTION_CLOCK_SKEW_SECONDS)) {
    fail('assertion not yet valid');
  }

  if (config.assertionAudience) {
    const audiences = Array.isArray(aud) ? aud : [aud];

    if (!audiences.includes(config.assertionAudience)) {
      fail('assertion audience mismatch');
    }
  }

  const signature = Buffer.from(encodedSignature, 'base64url');
  const expectedEcdsaLength = ECDSA_SIGNATURE_LENGTH[algorithm];

  if (expectedEcdsaLength !== undefined && signature.length !== expectedEcdsaLength) {
    fail('invalid assertion signature');
  }

  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii');
  let signatureValid = false;

  try {
    signatureValid = verify(
      digestFor(algorithm),
      signingInput,
      expectedEcdsaLength !== undefined ? { key: leafKey, dsaEncoding: 'ieee-p1363' } : leafKey,
      signature,
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    fail('invalid assertion signature');
  }

  return verifyClientCertificateChain(chain, config, 'assertion', now);
}

export interface CreateMtlsAssertionOptions {
  /** PEM bundle (leaf first) or certificates (leaf first). */
  certificateChain: string | readonly (X509Certificate | Buffer)[];
  /** PEM (PKCS#8 / PKCS#1 / SEC1) or key object of the leaf certificate. */
  privateKey: string | KeyObject;
  /** Lifetime in seconds (default 120; must not exceed the server's `MTLS_ASSERTION_MAX_LIFETIME`). */
  lifetimeSeconds?: number;
  /** `aud` claim (required when the server sets `MTLS_ASSERTION_AUDIENCE`). */
  audience?: string;
  now?: Date;
}

/**
 * Creates a certificate assertion for `Authorization: Certificate <assertion>` (Node clients, scripts, tests).
 * Browsers create the same format with WebCrypto (`@forepath/identity/frontend`).
 */
export function createMtlsAssertion(options: CreateMtlsAssertionOptions): string {
  const chain =
    typeof options.certificateChain === 'string'
      ? parseCertificateBundle(options.certificateChain, 'certificateChain')
      : options.certificateChain.map((entry) => (Buffer.isBuffer(entry) ? new X509Certificate(entry) : entry));

  if (chain.length === 0) {
    throw new Error('certificateChain must contain the client certificate');
  }

  const privateKey = typeof options.privateKey === 'string' ? createPrivateKey(options.privateKey) : options.privateKey;
  const algorithm = getMtlsAssertionAlgorithm(chain[0].publicKey);
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const header = { alg: algorithm, typ: MTLS_ASSERTION_TYPE, x5c: chain.map((cert) => cert.raw.toString('base64')) };
  const payload = {
    iat,
    exp: iat + (options.lifetimeSeconds ?? 120),
    jti: randomUUID(),
    ...(options.audience ? { aud: options.audience } : {}),
  };
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(
    JSON.stringify(payload),
  ).toString('base64url')}`;
  const signature = sign(
    digestFor(algorithm),
    Buffer.from(signingInput, 'ascii'),
    ECDSA_SIGNATURE_LENGTH[algorithm] !== undefined ? { key: privateKey, dsaEncoding: 'ieee-p1363' } : privateKey,
  );

  return `${signingInput}.${signature.toString('base64url')}`;
}
