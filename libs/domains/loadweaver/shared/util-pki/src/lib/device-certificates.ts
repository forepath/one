import 'reflect-metadata';

import { createHash, webcrypto } from 'node:crypto';

import * as x509 from '@peculiar/x509';

/**
 * Device certificates as a posture fact (3.31): a client certificate issued by a company CA (bundle configured by
 * cluster admins, optional CRLs) or by the cluster's own CA at enrollment. Signature, validity period, CA flags and
 * revocation are checked here; binding the certificate to a device is the caller's job.
 */

const crypto = webcrypto as unknown as Crypto;

x509.cryptoProvider.set(crypto);

const MAX_BUNDLE_CERTIFICATES = 64;
const MAX_CHAIN_DEPTH = 5;

export interface DeviceCertificateCheck {
  valid: boolean;
  /** Why it isn't valid (expired, not trusted, revoked, …). */
  reasons: string[];
  revoked: boolean;
  serialNumber?: string;
  subject?: string;
  issuer?: string;
  notAfter?: Date;
  fingerprintSha256?: string;
  /** URI / DNS SANs (for binding to a device). */
  uris: string[];
  dnsNames: string[];
}

/** Every certificate of a PEM bundle; throws on garbage or more than 64 certificates. */
export function parseCertificateBundle(pem: string): x509.X509Certificate[] {
  const blocks = x509.PemConverter.decode(pem);

  if (blocks.length === 0) throw new Error('no certificate in the bundle');

  if (blocks.length > MAX_BUNDLE_CERTIFICATES) throw new Error(`at most ${MAX_BUNDLE_CERTIFICATES} certificates`);

  return blocks.map((der) => new x509.X509Certificate(der));
}

/** CRLs of a PEM bundle (`X509 CRL` blocks). */
export function parseCrlBundle(pem: string): x509.X509Crl[] {
  const blocks = x509.PemConverter.decode(pem);

  if (blocks.length === 0) throw new Error('no CRL in the bundle');

  if (blocks.length > MAX_BUNDLE_CERTIFICATES) throw new Error(`at most ${MAX_BUNDLE_CERTIFICATES} CRLs`);

  return blocks.map((der) => new x509.X509Crl(der));
}

function isCa(cert: x509.X509Certificate): boolean {
  return cert.getExtension(x509.BasicConstraintsExtension)?.ca === true;
}

/**
 * Key usage of a device certificate: keyUsage must be present with digitalSignature (the proof of possession is a
 * signature), and an extended key usage, when present, must include clientAuth — a company CA's server / code
 * signing / e-mail certificates are no device certificates. Without an EKU extension the certificate is accepted on
 * its keyUsage alone (RFC 5280: no EKU = no restriction).
 */
export function usageIssues(leaf: x509.X509Certificate): string[] {
  const issues: string[] = [];
  const keyUsage = leaf.getExtension(x509.KeyUsagesExtension);

  if (!keyUsage || (keyUsage.usages & x509.KeyUsageFlags.digitalSignature) === 0)
    issues.push('the device certificate does not allow digital signatures (keyUsage digitalSignature)');

  const eku = leaf.getExtension(x509.ExtendedKeyUsageExtension);

  if (eku && !eku.usages.map(String).includes(x509.ExtendedKeyUsage.clientAuth))
    issues.push('the device certificate is not for client authentication (extendedKeyUsage clientAuth)');

  return issues;
}

/** Problems of a CA bundle an admin uploads: not a CA, expired. */
export function caBundleIssues(pem: string, now: Date = new Date()): string[] {
  let certs: x509.X509Certificate[];

  try {
    certs = parseCertificateBundle(pem);
  } catch (error) {
    return [error instanceof Error ? error.message : 'invalid certificate bundle'];
  }

  return certs.flatMap((c) => [
    ...(isCa(c) ? [] : [`${c.subject} is not a CA certificate`]),
    ...(now > c.notAfter ? [`${c.subject} expired ${c.notAfter.toISOString()}`] : []),
  ]);
}

async function signedBy(cert: x509.X509Certificate, issuer: x509.X509Certificate, now: Date): Promise<boolean> {
  if (cert.issuer !== issuer.subject) return false;

  try {
    return await cert.verify({ publicKey: issuer.publicKey, date: now, signatureOnly: true });
  } catch {
    return false;
  }
}

/**
 * Verifies a device certificate against trust anchors (every certificate in the bundle is trusted; intermediates
 * may come with the bundle) and optional CRLs of the issuers. Revocation is only known where a CRL of the issuer is
 * configured; an outdated CRL makes the certificate invalid (fail closed).
 */
export async function verifyDeviceCertificate(params: {
  certificatePem: string;
  trustBundlePem: string;
  crlPem?: string;
  now?: Date;
}): Promise<DeviceCertificateCheck> {
  const now = params.now ?? new Date();
  let leaf: x509.X509Certificate;

  try {
    const blocks = x509.PemConverter.decode(params.certificatePem);

    if (blocks.length !== 1) throw new Error('one certificate expected');

    leaf = new x509.X509Certificate(blocks[0]);
  } catch {
    return {
      valid: false,
      revoked: false,
      reasons: ['the device certificate could not be parsed'],
      uris: [],
      dnsNames: [],
    };
  }

  const san = leaf.getExtension(x509.SubjectAlternativeNameExtension);
  const result: DeviceCertificateCheck = {
    valid: false,
    revoked: false,
    reasons: [],
    serialNumber: leaf.serialNumber.toLowerCase(),
    subject: leaf.subject,
    issuer: leaf.issuer,
    notAfter: leaf.notAfter,
    fingerprintSha256: createHash('sha256').update(Buffer.from(leaf.rawData)).digest('hex'),
    uris: san?.names.items.filter((n) => n.type === 'url').map((n) => n.value) ?? [],
    dnsNames: san?.names.items.filter((n) => n.type === 'dns').map((n) => n.value) ?? [],
  };

  if (now < leaf.notBefore) result.reasons.push('the device certificate is not valid yet');

  if (now > leaf.notAfter) result.reasons.push(`the device certificate expired ${leaf.notAfter.toISOString()}`);

  if (isCa(leaf)) result.reasons.push('a CA certificate is not a device certificate');

  result.reasons.push(...usageIssues(leaf));

  let anchors: x509.X509Certificate[];

  try {
    anchors = parseCertificateBundle(params.trustBundlePem);
  } catch {
    result.reasons.push('the trusted CA bundle is invalid');

    return result;
  }

  // Walk up through the bundle until a trusted certificate signed the current one.
  let current = leaf;
  let issuer: x509.X509Certificate | undefined;

  for (let depth = 0; depth < MAX_CHAIN_DEPTH && !issuer; depth++) {
    let next: x509.X509Certificate | undefined;

    for (const candidate of anchors)
      if (isCa(candidate) && (await signedBy(current, candidate, now))) {
        next = candidate;
        break;
      }

    if (!next) break;

    if (now > next.notAfter || now < next.notBefore) {
      result.reasons.push(`the issuing CA ${next.subject} is outside its validity period`);
      break;
    }

    // Every bundle certificate is a trust anchor: the first verified issuer ends the walk.
    issuer = next;
    current = next;
  }

  if (!issuer) {
    if (!result.reasons.some((r) => r.startsWith('the issuing CA')))
      result.reasons.push('the device certificate is not issued by a trusted CA');

    return result;
  }

  if (params.crlPem?.trim()) {
    let crls: x509.X509Crl[] = [];

    try {
      crls = parseCrlBundle(params.crlPem);
    } catch {
      result.reasons.push('the configured CRLs are invalid');
    }

    for (const crl of crls) {
      if (crl.issuer !== issuer.subject) continue;

      let verified = false;

      try {
        verified = await crl.verify({ publicKey: issuer.publicKey });
      } catch {
        verified = false;
      }

      if (!verified) {
        result.reasons.push(`the CRL of ${issuer.subject} has an invalid signature`);
        continue;
      }

      if (crl.nextUpdate && now > crl.nextUpdate)
        result.reasons.push(`the CRL of ${issuer.subject} is outdated (next update ${crl.nextUpdate.toISOString()})`);

      if (crl.findRevoked(leaf)) {
        result.revoked = true;
        result.reasons.push('the device certificate is revoked');
      }
    }
  }

  result.valid = result.reasons.length === 0;

  return result;
}

function hashFor(key: CryptoKey): string {
  const algorithm = key.algorithm as EcKeyAlgorithm | RsaHashedKeyAlgorithm;

  if ('namedCurve' in algorithm) return algorithm.namedCurve === 'P-384' ? 'SHA-384' : 'SHA-256';

  return 'SHA-256';
}

/**
 * Proof of possession: the device signed `message` with the certificate's private key (ECDSA P-256 / P-384 with
 * SHA-256 / SHA-384, raw or DER-encoded signature; RSA PKCS#1 v1.5 with SHA-256).
 */
export async function verifyPossession(
  certificatePem: string,
  message: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const cert = new x509.X509Certificate(certificatePem);
    const algorithmName = (cert.publicKey.algorithm as Algorithm).name;
    const data = new TextEncoder().encode(message);
    let signature = new Uint8Array(Buffer.from(signatureBase64, 'base64'));

    if (algorithmName === 'ECDSA') {
      const key = await cert.publicKey.export(crypto);
      const hash = hashFor(key);
      const size = hash === 'SHA-384' ? 48 : 32;

      // DER (what most platform APIs produce) → raw r || s (what WebCrypto verifies).
      if (signature[0] === 0x30) {
        const raw = new x509.AsnEcSignatureFormatter().toWebSignature(
          { name: 'ECDSA', hash: { name: hash }, namedCurve: hash === 'SHA-384' ? 'P-384' : 'P-256' } as EcdsaParams,
          signature,
        );

        if (!raw) return false;

        signature = new Uint8Array(raw);
      }

      if (signature.length !== size * 2) return false;

      return await crypto.subtle.verify({ name: 'ECDSA', hash: { name: hash } }, key, signature, data);
    }

    if (algorithmName === 'RSASSA-PKCS1-v1_5') {
      const key = await cert.publicKey.export(
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as RsaHashedImportParams,
        ['verify'],
        crypto,
      );

      return await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, data);
    }

    return false;
  } catch {
    return false;
  }
}
