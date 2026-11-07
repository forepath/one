import { createHash, generateKeyPairSync, KeyObject, randomBytes, sign, X509Certificate } from 'node:crypto';

/**
 * Test-only X.509 builder (DER) so specs and e2e harnesses can mint CAs and client certificates at runtime
 * without committing private keys (secret scanners) or depending on the `openssl` CLI.
 *
 * Not exported from the library barrel.
 */

export type TestKeyType = 'ec-p256' | 'ec-p384' | 'ec-p521' | 'rsa-2048' | 'rsa-1024' | 'ed25519' | 'ec-secp256k1';

export interface TestCertificateOptions {
  commonName: string;
  /** Issuer certificate + key; omitted → self-signed. */
  issuer?: { certificate: TestCertificate };
  keyType?: TestKeyType;
  /** Reuse an existing key pair (e.g. to re-issue a certificate). */
  keyPair?: { publicKey: KeyObject; privateKey: KeyObject };
  isCa?: boolean;
  /** Extended key usage OIDs; `undefined` → clientAuth for leaves / none for CAs, `null` → extension omitted. */
  extendedKeyUsage?: readonly string[] | null;
  notBefore?: Date;
  notAfter?: Date;
}

export interface TestCertificate {
  certificate: X509Certificate;
  der: Buffer;
  pem: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
  privateKeyPem: string;
  fingerprint256: string;
}

export const OID_CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';
export const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

function encodeLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }

  const bytes: number[] = [];
  let remaining = length;

  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }

  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const octetString = (content: Buffer) => tlv(0x04, content);
const bitString = (content: Buffer, unusedBits = 0) => tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), content]));
const explicit = (tagNumber: number, content: Buffer) => tlv(0xa0 + tagNumber, content);
const derNull = () => Buffer.from([0x05, 0x00]);
const derBoolean = (value: boolean) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const utf8String = (value: string) => tlv(0x0c, Buffer.from(value, 'utf8'));

function derInteger(value: Buffer | number): Buffer {
  let bytes = typeof value === 'number' ? Buffer.from([value]) : Buffer.from(value);

  while (bytes.length > 1 && bytes[0] === 0x00 && (bytes[1] & 0x80) === 0) {
    bytes = bytes.subarray(1);
  }

  if (bytes[0] & 0x80) {
    bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
  }

  return tlv(0x02, bytes);
}

function derOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [parts[0] * 40 + parts[1]];

  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    let remaining = part >> 7;

    while (remaining > 0) {
      chunk.unshift((remaining & 0x7f) | 0x80);
      remaining >>= 7;
    }

    bytes.push(...chunk);
  }

  return tlv(0x06, Buffer.from(bytes));
}

function derTime(date: Date): Buffer {
  const iso = date.toISOString();
  const compact = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  const year = date.getUTCFullYear();

  // RFC 5280: UTCTime through 2049, GeneralizedTime from 2050.
  return year < 2050 ? tlv(0x17, Buffer.from(compact.slice(2), 'ascii')) : tlv(0x18, Buffer.from(compact, 'ascii'));
}

function name(commonName: string): Buffer {
  return seq(set(seq(derOid('2.5.4.3'), utf8String(commonName))));
}

function extension(oid: string, critical: boolean, value: Buffer): Buffer {
  return seq(derOid(oid), ...(critical ? [derBoolean(true)] : []), octetString(value));
}

function generateKeyPair(keyType: TestKeyType): { publicKey: KeyObject; privateKey: KeyObject } {
  switch (keyType) {
    case 'ec-p256':
      return generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    case 'ec-p384':
      return generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    case 'ec-p521':
      return generateKeyPairSync('ec', { namedCurve: 'secp521r1' });
    case 'ec-secp256k1':
      return generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    case 'rsa-2048':
      return generateKeyPairSync('rsa', { modulusLength: 2048 });
    case 'rsa-1024':
      return generateKeyPairSync('rsa', { modulusLength: 1024 });
    case 'ed25519':
      return generateKeyPairSync('ed25519');
  }
}

function signatureAlgorithm(issuerKey: KeyObject): { identifier: Buffer; digest: string | null } {
  switch (issuerKey.asymmetricKeyType) {
    case 'ec':
      return { identifier: seq(derOid('1.2.840.10045.4.3.2')), digest: 'sha256' };
    case 'rsa':
      return { identifier: seq(derOid('1.2.840.113549.1.1.11'), derNull()), digest: 'sha256' };
    case 'ed25519':
      return { identifier: seq(derOid('1.3.101.112')), digest: null };
    default:
      throw new Error(`Unsupported issuer key type: ${issuerKey.asymmetricKeyType}`);
  }
}

/** Mints a certificate (self-signed when no issuer is given). */
export function createTestCertificate(options: TestCertificateOptions): TestCertificate {
  const isCa = options.isCa ?? false;
  const keyPair = options.keyPair ?? generateKeyPair(options.keyType ?? 'ec-p256');
  const issuerName = options.issuer ? options.issuer.certificate.certificate.subject : undefined;
  const issuerCommonName = issuerName
    ?.split('\n')
    .find((line) => line.startsWith('CN='))
    ?.slice(3);
  const signingKey = options.issuer?.certificate.privateKey ?? keyPair.privateKey;
  const algorithm = signatureAlgorithm(signingKey);
  const notBefore = options.notBefore ?? new Date(Date.now() - 60 * 60 * 1000);
  const notAfter = options.notAfter ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const extendedKeyUsage =
    options.extendedKeyUsage === undefined ? (isCa ? null : [OID_CLIENT_AUTH]) : options.extendedKeyUsage;
  const extensions: Buffer[] = [
    extension('2.5.29.19', true, isCa ? seq(derBoolean(true)) : seq()),
    // keyUsage: CA → keyCertSign + cRLSign (0x06, 1 unused bit); leaf → digitalSignature (0x80, 7 unused bits)
    extension('2.5.29.15', true, isCa ? bitString(Buffer.from([0x06]), 1) : bitString(Buffer.from([0x80]), 7)),
  ];

  if (extendedKeyUsage) {
    extensions.push(extension('2.5.29.37', false, seq(...extendedKeyUsage.map((oid) => derOid(oid)))));
  }

  const spki = keyPair.publicKey.export({ type: 'spki', format: 'der' });
  const tbs = seq(
    explicit(0, derInteger(2)),
    derInteger(Buffer.concat([Buffer.from([0x01]), randomBytes(15)])),
    algorithm.identifier,
    name(issuerCommonName ?? options.commonName),
    seq(derTime(notBefore), derTime(notAfter)),
    name(options.commonName),
    spki,
    explicit(3, seq(...extensions)),
  );
  const signature = sign(algorithm.digest, tbs, signingKey);
  const der = seq(tbs, algorithm.identifier, bitString(signature));
  const certificate = new X509Certificate(der);
  const pem = `-----BEGIN CERTIFICATE-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)
    ?.join('\n')}\n-----END CERTIFICATE-----\n`;

  return {
    certificate,
    der,
    pem,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    privateKeyPem: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerprint256: createHash('sha256').update(der).digest('hex'),
  };
}

export interface TestPki {
  rootCa: TestCertificate;
  intermediateCa: TestCertificate;
  /** Leaf issued directly by the root. */
  client: TestCertificate;
  /** Leaf issued by the intermediate (chain: leaf, intermediate). */
  intermediateClient: TestCertificate;
  /** Leaf of an unrelated CA. */
  foreignClient: TestCertificate;
}

/** Root + intermediate CA, a direct client, an intermediate-issued client and a foreign client. */
export function createTestPki(keyType: TestKeyType = 'ec-p256'): TestPki {
  const rootCa = createTestCertificate({ commonName: 'Test Root CA', isCa: true, keyType });
  const intermediateCa = createTestCertificate({
    commonName: 'Test Intermediate CA',
    isCa: true,
    keyType,
    issuer: { certificate: rootCa },
  });
  const client = createTestCertificate({ commonName: 'api-client', keyType, issuer: { certificate: rootCa } });
  const intermediateClient = createTestCertificate({
    commonName: 'intermediate-client',
    keyType,
    issuer: { certificate: intermediateCa },
  });
  const foreignCa = createTestCertificate({ commonName: 'Foreign CA', isCa: true, keyType });
  const foreignClient = createTestCertificate({
    commonName: 'api-client',
    keyType,
    issuer: { certificate: foreignCa },
  });

  return { rootCa, intermediateCa, client, intermediateClient, foreignClient };
}
