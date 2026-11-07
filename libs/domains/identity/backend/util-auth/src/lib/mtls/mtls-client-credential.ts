import { createPrivateKey, createPublicKey, type KeyObject, X509Certificate } from 'node:crypto';

import { createMtlsAssertion, getMtlsAssertionAlgorithm } from './mtls-assertion';
import { assertAcceptableClientKey, getCertificateCommonName, MtlsVerificationError } from './mtls-certificate';
import {
  MTLS_AUTHORIZATION_SCHEME,
  MTLS_MAX_CHAIN_LENGTH,
  normalizeFingerprint,
  parseCertificateBundle,
} from './mtls.config';

/**
 * Outbound side of mTLS: a service (e.g. the agent-controller) authenticating against an API that runs
 * `AUTHENTICATION_METHOD=mtls` (e.g. an agent-manager) with a stored client certificate and private key.
 */

/** Max size of a stored PEM certificate chain / private key. */
export const MTLS_CLIENT_PEM_MAX_LENGTH = 32 * 1024;

/** Lifetime of assertions created for outbound requests (one per request / handshake). */
export const MTLS_CLIENT_ASSERTION_LIFETIME_SECONDS = 60;

/** Invalid client certificate / key pair; the message is safe to show to the admin configuring it. */
export class MtlsClientCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MtlsClientCredentialError';
  }
}

export interface MtlsClientCredentialSummary {
  /** SHA-256 fingerprint of the leaf certificate (lowercase hex). */
  fingerprint256: string;
  commonName?: string;
  /** Leaf expiry (ISO 8601). */
  validTo: string;
}

function fail(message: string): never {
  throw new MtlsClientCredentialError(message);
}

function parsePrivateKey(privateKeyPem: string): KeyObject {
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(privateKeyPem)) {
    fail('Encrypted private keys are not supported. Provide the unencrypted PEM key.');
  }

  try {
    const key = createPrivateKey(privateKeyPem);

    if (key.type !== 'private') {
      fail('The private key is not a private key.');
    }

    return key;
  } catch (error) {
    if (error instanceof MtlsClientCredentialError) {
      throw error;
    }

    return fail('The private key is not a valid PEM private key.');
  }
}

/**
 * Validates a client certificate chain (PEM, leaf first) and its private key before storing them: parseable, at most
 * 5 certificates, currently valid, an accepted key type that matches the leaf certificate. Trust is decided by the
 * server the credential is presented to.
 *
 * @throws MtlsClientCredentialError with an admin-facing message
 */
export function validateMtlsClientCredential(
  certificatePem: string,
  privateKeyPem: string,
  now: Date = new Date(),
): MtlsClientCredentialSummary {
  if (certificatePem.length > MTLS_CLIENT_PEM_MAX_LENGTH || privateKeyPem.length > MTLS_CLIENT_PEM_MAX_LENGTH) {
    fail('The client certificate or private key is too large.');
  }

  let chain: X509Certificate[];

  try {
    chain = parseCertificateBundle(certificatePem, 'certificate');
  } catch {
    return fail('The client certificate is not a valid PEM certificate.');
  }

  if (chain.length > MTLS_MAX_CHAIN_LENGTH) {
    fail(`The client certificate may contain at most ${MTLS_MAX_CHAIN_LENGTH} certificates.`);
  }

  const [leaf] = chain;
  const privateKey = parsePrivateKey(privateKeyPem);
  const leafSpki = leaf.publicKey.export({ type: 'spki', format: 'der' });
  const keySpki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });

  if (!leafSpki.equals(keySpki)) {
    fail('The private key does not belong to the client certificate (the leaf certificate must come first).');
  }

  try {
    assertAcceptableClientKey(leaf.publicKey);
    getMtlsAssertionAlgorithm(leaf.publicKey);
  } catch (error) {
    fail(`Unsupported client certificate key: ${error instanceof MtlsVerificationError ? error.message : 'unknown'}.`);
  }

  if (leaf.ca) {
    fail('A CA certificate cannot be used as client certificate.');
  }

  if (Date.parse(leaf.validTo) < now.getTime()) {
    fail('The client certificate has expired.');
  }

  if (Date.parse(leaf.validFrom) > now.getTime()) {
    fail('The client certificate is not valid yet.');
  }

  const commonName = getCertificateCommonName(leaf.subject);

  return {
    fingerprint256: normalizeFingerprint(leaf.fingerprint256),
    ...(commonName ? { commonName } : {}),
    validTo: new Date(Date.parse(leaf.validTo)).toISOString(),
  };
}

/** Summary of a stored client certificate for API responses; `undefined` when it cannot be parsed. */
export function describeMtlsClientCertificate(
  certificatePem: string | null | undefined,
): MtlsClientCredentialSummary | undefined {
  if (!certificatePem) {
    return undefined;
  }

  try {
    const [leaf] = parseCertificateBundle(certificatePem, 'certificate');
    const commonName = getCertificateCommonName(leaf.subject);

    return {
      fingerprint256: normalizeFingerprint(leaf.fingerprint256),
      ...(commonName ? { commonName } : {}),
      validTo: new Date(Date.parse(leaf.validTo)).toISOString(),
    };
  } catch {
    return undefined;
  }
}

/**
 * `Authorization` value for one outbound request / websocket handshake: a fresh, short-lived certificate assertion.
 * `audience` should be the target's origin so the target can bind assertions with `MTLS_ASSERTION_AUDIENCE`.
 */
export function createMtlsAuthorizationHeader(options: {
  certificateChain: string;
  privateKey: string;
  audience?: string;
}): string {
  return `${MTLS_AUTHORIZATION_SCHEME} ${createMtlsAssertion({
    certificateChain: options.certificateChain,
    privateKey: options.privateKey,
    lifetimeSeconds: MTLS_CLIENT_ASSERTION_LIFETIME_SECONDS,
    audience: options.audience,
  })}`;
}
