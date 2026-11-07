import type { KeyObject, X509Certificate } from 'node:crypto';

import { MTLS_MAX_CHAIN_LENGTH, normalizeFingerprint, type MtlsConfig } from './mtls.config';

/** OID of the `clientAuth` extended key usage (RFC 5280 §4.2.1.12). */
export const CLIENT_AUTH_EXTENDED_KEY_USAGE = '1.3.6.1.5.5.7.3.2';

/** Minimum RSA modulus length of client certificates. */
export const MTLS_MIN_RSA_MODULUS_BITS = 2048;

const ACCEPTED_EC_CURVES = new Set(['prime256v1', 'secp384r1', 'secp521r1']);

/** How the client proved possession of the certificate's private key. */
export type MtlsCredentialSource = 'tls' | 'assertion';

/** Identity of an authenticated client certificate (attached to the request for audit logging). */
export interface MtlsClientPrincipal {
  source: MtlsCredentialSource;
  /** Full subject distinguished name (OpenSSL one-line-per-attribute format). */
  subject: string;
  /** Subject common name, when present. */
  commonName?: string;
  issuer: string;
  serialNumber: string;
  /** SHA-256 fingerprint of the leaf certificate (lowercase hex). */
  fingerprint256: string;
  /** Expiry of the leaf certificate (ISO 8601). */
  validTo: string;
}

/** A client certificate (chain) was presented but must not authenticate. The reason is for logs only. */
export class MtlsVerificationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'MtlsVerificationError';
  }
}

function fail(reason: string): never {
  throw new MtlsVerificationError(reason);
}

function isValidAt(certificate: X509Certificate, now: Date): boolean {
  const notBefore = Date.parse(certificate.validFrom);
  const notAfter = Date.parse(certificate.validTo);

  return (
    Number.isFinite(notBefore) && Number.isFinite(notAfter) && notBefore <= now.getTime() && now.getTime() <= notAfter
  );
}

/** Subject common name (`CN=`) of an X.509 subject string. */
export function getCertificateCommonName(subject: string): string | undefined {
  const line = subject.split('\n').find((attribute) => attribute.startsWith('CN='));

  return line ? line.slice(3) : undefined;
}

/** Rejects weak or unsupported client keys (RSA < 2048 bits, non-NIST curves, DSA, …). */
export function assertAcceptableClientKey(publicKey: KeyObject): void {
  const details = publicKey.asymmetricKeyDetails;

  switch (publicKey.asymmetricKeyType) {
    case 'rsa':
      if ((details?.modulusLength ?? 0) < MTLS_MIN_RSA_MODULUS_BITS) {
        fail(`RSA keys must have at least ${MTLS_MIN_RSA_MODULUS_BITS} bits`);
      }

      return;
    case 'ec':
      if (!details?.namedCurve || !ACCEPTED_EC_CURVES.has(details.namedCurve)) {
        fail('unsupported elliptic curve');
      }

      return;
    case 'ed25519':
      return;
    default:
      fail(`unsupported key type: ${publicKey.asymmetricKeyType ?? 'unknown'}`);
  }
}

function isIssuedBy(child: X509Certificate, issuer: X509Certificate): boolean {
  try {
    return child.checkIssued(issuer) && child.verify(issuer.publicKey);
  } catch {
    return false;
  }
}

/**
 * Whether `leaf` chains to a trust anchor, optionally through `intermediates` (which must be valid CA certificates).
 * A trust anchor without the CA flag only matches itself (a pinned, typically self-signed, client certificate).
 */
function chainsToTrustAnchor(
  leaf: X509Certificate,
  intermediates: readonly X509Certificate[],
  trustAnchors: readonly X509Certificate[],
  now: Date,
): boolean {
  if (trustAnchors.some((anchor) => !anchor.ca && anchor.raw.equals(leaf.raw))) {
    return true;
  }

  const unused = [...intermediates];
  let current = leaf;

  for (let depth = 0; depth < MTLS_MAX_CHAIN_LENGTH; depth++) {
    if (trustAnchors.some((anchor) => anchor.ca && isValidAt(anchor, now) && isIssuedBy(current, anchor))) {
      return true;
    }

    const index = unused.findIndex(
      (candidate) => candidate.ca && isValidAt(candidate, now) && isIssuedBy(current, candidate),
    );

    if (index === -1) {
      return false;
    }

    [current] = unused.splice(index, 1);
  }

  return false;
}

/**
 * Verifies a client certificate chain (`[leaf, ...intermediates]`) against the mTLS configuration and returns the
 * authenticated principal. Proof of possession of the leaf's private key is the caller's job (TLS handshake or
 * assertion signature). Checks, in order:
 *
 * - leaf is currently valid, is not a CA, allows `clientAuth` (when it restricts extended key usage) and has an
 *   acceptable key
 * - leaf is not revoked (`MTLS_REVOKED_FINGERPRINTS`)
 * - leaf chains to a trusted CA through valid CA intermediates (signatures verified)
 * - leaf matches the fingerprint / subject allowlists when configured
 *
 * @throws MtlsVerificationError when the chain must not authenticate
 */
export function verifyClientCertificateChain(
  chain: readonly X509Certificate[],
  config: MtlsConfig,
  source: MtlsCredentialSource,
  now: Date = new Date(),
): MtlsClientPrincipal {
  if (chain.length === 0) {
    fail('no client certificate');
  }

  if (chain.length > MTLS_MAX_CHAIN_LENGTH) {
    fail('certificate chain too long');
  }

  const [leaf, ...intermediates] = chain;

  if (!isValidAt(leaf, now)) {
    fail('client certificate expired or not yet valid');
  }

  if (leaf.ca) {
    fail('CA certificates cannot authenticate');
  }

  const extendedKeyUsage = leaf.keyUsage;

  if (extendedKeyUsage !== undefined && !extendedKeyUsage.includes(CLIENT_AUTH_EXTENDED_KEY_USAGE)) {
    fail('certificate is not valid for client authentication');
  }

  assertAcceptableClientKey(leaf.publicKey);

  const fingerprint256 = normalizeFingerprint(leaf.fingerprint256);

  if (config.revokedFingerprints.has(fingerprint256)) {
    fail('client certificate is revoked');
  }

  if (!chainsToTrustAnchor(leaf, intermediates, config.trustAnchors, now)) {
    fail('client certificate is not issued by a trusted CA');
  }

  const commonName = getCertificateCommonName(leaf.subject);

  if (config.allowedFingerprints || config.allowedSubjects) {
    const allowedByFingerprint = config.allowedFingerprints?.has(fingerprint256) ?? false;
    const allowedBySubject = !!commonName && (config.allowedSubjects?.has(commonName) ?? false);

    if (!allowedByFingerprint && !allowedBySubject) {
      fail('client certificate is not allowlisted');
    }
  }

  return {
    source,
    subject: leaf.subject,
    ...(commonName ? { commonName } : {}),
    issuer: leaf.issuer,
    serialNumber: leaf.serialNumber,
    fingerprint256,
    validTo: new Date(Date.parse(leaf.validTo)).toISOString(),
  };
}
