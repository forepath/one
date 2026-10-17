import 'reflect-metadata';

import { createHash, randomBytes, webcrypto } from 'node:crypto';

import * as x509 from '@peculiar/x509';

/**
 * Cluster PKI: one cluster CA issues node identities (3.21), and later workload identities for mTLS (3.7).
 * ECDSA P-256 keys; private keys never leave the machine that generated them (CSR flow).
 */

const crypto = webcrypto as unknown as Crypto;

x509.cryptoProvider.set(crypto);

const EC_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;

export type IdentityKind = 'node' | 'workload' | 'client' | 'control-plane';

export interface PemKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

export interface CertificateAuthority {
  certificatePem: string;
  privateKeyPem: string;
}

export interface IssuedCertificate {
  certificatePem: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  fingerprintSha256: string;
  identity: string;
}

export interface VerifiedIdentity {
  identity: string;
  kind: IdentityKind;
  name: string;
  clusterId: string;
  serialNumber: string;
  notAfter: Date;
  fingerprintSha256: string;
}

const IDENTITY_KINDS: readonly IdentityKind[] = ['node', 'workload', 'client', 'control-plane'];
/**
 * Identity names: node names, `project/deployment/service` (compose service names may contain `_`), user devices;
 * restricted charset keeps URIs unambiguous.
 */
const IDENTITY_NAME = /^[a-z0-9]([a-z0-9_.-]*[a-z0-9])?(\/[a-z0-9]([a-z0-9_.-]*[a-z0-9])?)*$/;
const CLUSTER_ID = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** SPIFFE-style identity URI carried as URI SAN: `spiffe://<cluster>.loadweaver/<kind>/<name>`. */
export function identityUri(clusterId: string, kind: IdentityKind, name: string): string {
  if (!CLUSTER_ID.test(clusterId)) throw new Error('invalid cluster id');

  if (!IDENTITY_KINDS.includes(kind)) throw new Error('invalid identity kind');

  if (!IDENTITY_NAME.test(name) || name.length > 200) throw new Error('invalid identity name');

  return `spiffe://${clusterId}.loadweaver/${kind}/${name}`;
}

export function parseIdentityUri(uri: string): { clusterId: string; kind: IdentityKind; name: string } | null {
  const match = /^spiffe:\/\/([a-z0-9-]+)\.loadweaver\/([a-z-]+)\/(.+)$/.exec(uri);

  if (!match) return null;

  const [, clusterId, kind, name] = match;

  if (!IDENTITY_KINDS.includes(kind as IdentityKind) || !IDENTITY_NAME.test(name) || !CLUSTER_ID.test(clusterId))
    return null;

  return { clusterId, kind: kind as IdentityKind, name };
}

function toPem(der: ArrayBuffer, label: string): string {
  return x509.PemConverter.encode(der, label);
}

function fromPem(pem: string): ArrayBuffer {
  const blocks = x509.PemConverter.decode(pem);

  if (blocks.length !== 1) throw new Error('expected exactly one PEM block');

  return blocks[0];
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', fromPem(pem), EC_ALGORITHM, false, ['sign']);
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', fromPem(pem), EC_ALGORITHM, true, ['verify']);
}

async function exportPair(keys: CryptoKeyPair): Promise<PemKeyPair> {
  return {
    privateKeyPem: toPem(await crypto.subtle.exportKey('pkcs8', keys.privateKey), 'PRIVATE KEY'),
    publicKeyPem: toPem(await crypto.subtle.exportKey('spki', keys.publicKey), 'PUBLIC KEY'),
  };
}

export async function generateKeyPair(): Promise<PemKeyPair> {
  return exportPair((await crypto.subtle.generateKey(EC_ALGORITHM, true, ['sign', 'verify'])) as CryptoKeyPair);
}

function randomSerial(): string {
  const bytes = randomBytes(16);

  // Positive serial (RFC 5280: non-negative, ≤ 20 octets).
  bytes[0] &= 0x7f;

  return bytes.toString('hex');
}

function sha256Fingerprint(cert: x509.X509Certificate): string {
  return createHash('sha256').update(Buffer.from(cert.rawData)).digest('hex');
}

export async function createCertificateAuthority(params: {
  commonName: string;
  validityDays: number;
  now?: Date;
}): Promise<CertificateAuthority> {
  const keys = (await crypto.subtle.generateKey(EC_ALGORITHM, true, ['sign', 'verify'])) as CryptoKeyPair;
  const now = params.now ?? new Date();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerial(),
    name: [{ CN: [params.commonName] }],
    notBefore: new Date(now.getTime() - 60_000),
    notAfter: new Date(now.getTime() + params.validityDays * 86_400_000),
    signingAlgorithm: EC_ALGORITHM,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  const pair = await exportPair(keys);

  return { certificatePem: cert.toString('pem'), privateKeyPem: pair.privateKeyPem };
}

/** Builds a CSR on the requesting machine; the control plane decides the identity, not the CSR. */
export async function createCsr(keyPair: PemKeyPair, commonName: string): Promise<string> {
  const keys = {
    privateKey: await crypto.subtle.importKey('pkcs8', fromPem(keyPair.privateKeyPem), EC_ALGORITHM, true, ['sign']),
    publicKey: await importPublicKey(keyPair.publicKeyPem),
  };
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: [{ CN: [commonName] }],
    keys,
    signingAlgorithm: EC_ALGORITHM,
  });

  return csr.toString('pem');
}

/**
 * CSR for a public server certificate (ACME, 3.6): the DNS names as subject alternative names, the first one also as
 * common name. Returns PEM and DER (ACME wants base64url DER).
 */
export async function createServerCsr(keyPair: PemKeyPair, dnsNames: string[]): Promise<{ pem: string; der: Buffer }> {
  if (dnsNames.length === 0) throw new Error('a server certificate needs at least one DNS name');

  const keys = {
    privateKey: await crypto.subtle.importKey('pkcs8', fromPem(keyPair.privateKeyPem), EC_ALGORITHM, true, ['sign']),
    publicKey: await importPublicKey(keyPair.publicKeyPem),
  };
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: [{ CN: [dnsNames[0]] }],
    keys,
    signingAlgorithm: EC_ALGORITHM,
    extensions: [
      new x509.SubjectAlternativeNameExtension(
        dnsNames.map((value) => ({ type: 'dns' as const, value })),
        false,
      ),
    ],
  });

  return { pem: csr.toString('pem'), der: Buffer.from(csr.rawData) };
}

export interface IssueCertificateParams {
  ca: CertificateAuthority;
  csrPem: string;
  clusterId: string;
  kind: IdentityKind;
  name: string;
  /** Extra DNS SANs (e.g. the control-plane API hostname); only set by the control plane itself. */
  dnsNames?: string[];
  ipAddresses?: string[];
  validityHours: number;
  now?: Date;
}

/**
 * Signs a CSR. The CSR's own subject and extensions are ignored: identity, SANs, usages and lifetime come
 * from the caller (the control plane), so a node can't request a name it doesn't own.
 */
export async function issueCertificate(params: IssueCertificateParams): Promise<IssuedCertificate> {
  const csr = new x509.Pkcs10CertificateRequest(params.csrPem);

  if (!(await csr.verify())) throw new Error('CSR signature is invalid');

  const algorithm = csr.publicKey.algorithm as EcKeyAlgorithm;

  if (algorithm.name !== 'ECDSA' || algorithm.namedCurve !== 'P-256')
    throw new Error('only ECDSA P-256 keys are accepted');

  const caCert = new x509.X509Certificate(params.ca.certificatePem);
  const identity = identityUri(params.clusterId, params.kind, params.name);
  const now = params.now ?? new Date();
  const notBefore = new Date(now.getTime() - 60_000);
  const notAfter = new Date(Math.min(now.getTime() + params.validityHours * 3_600_000, caCert.notAfter.getTime()));
  const serialNumber = randomSerial();
  const names: x509.JsonGeneralName[] = [
    { type: 'url', value: identity },
    ...(params.dnsNames ?? []).map((value) => ({ type: 'dns' as const, value })),
    ...(params.ipAddresses ?? []).map((value) => ({ type: 'ip' as const, value })),
  ];
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber,
    subject: [{ CN: [`${params.kind}:${params.name}`] }],
    issuer: caCert.subject,
    notBefore,
    notAfter,
    signingAlgorithm: EC_ALGORITHM,
    publicKey: csr.publicKey,
    signingKey: await importPrivateKey(params.ca.privateKeyPem),
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyAgreement, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth, x509.ExtendedKeyUsage.clientAuth], false),
      new x509.SubjectAlternativeNameExtension(names, false),
      await x509.AuthorityKeyIdentifierExtension.create(caCert, false),
      await x509.SubjectKeyIdentifierExtension.create(csr.publicKey),
    ],
  });

  return {
    certificatePem: cert.toString('pem'),
    serialNumber,
    notBefore,
    notAfter,
    fingerprintSha256: sha256Fingerprint(cert),
    identity,
  };
}

/**
 * Verifies a leaf certificate against the cluster CA and returns its identity. Callers must still check
 * revocation (serial / fingerprint) against the control plane's records.
 */
export async function verifyCertificate(
  certificatePem: string,
  caCertificatePem: string,
  now: Date = new Date(),
): Promise<VerifiedIdentity | null> {
  let cert: x509.X509Certificate;
  let ca: x509.X509Certificate;

  try {
    cert = new x509.X509Certificate(certificatePem);
    ca = new x509.X509Certificate(caCertificatePem);
  } catch {
    return null;
  }

  if (now < cert.notBefore || now > cert.notAfter) return null;

  if (cert.issuer !== ca.subject) return null;

  if (!(await cert.verify({ publicKey: ca.publicKey, date: now, signatureOnly: true }))) return null;

  const san = cert.getExtension(x509.SubjectAlternativeNameExtension);
  const uris = san?.names.items.filter((n) => n.type === 'url').map((n) => n.value) ?? [];

  if (uris.length !== 1) return null;

  const parsed = parseIdentityUri(uris[0]);

  if (!parsed) return null;

  return {
    identity: uris[0],
    ...parsed,
    serialNumber: cert.serialNumber,
    notAfter: cert.notAfter,
    fingerprintSha256: sha256Fingerprint(cert),
  };
}

/** Remaining lifetime fraction, used to rotate certificates automatically (3.21) at e.g. < 1/3 left. */
export function remainingLifetimeFraction(certificatePem: string, now: Date = new Date()): number {
  const cert = new x509.X509Certificate(certificatePem);
  const total = cert.notAfter.getTime() - cert.notBefore.getTime();

  return total <= 0 ? 0 : Math.max(0, (cert.notAfter.getTime() - now.getTime()) / total);
}
