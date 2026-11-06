/**
 * Browser side of `AUTHENTICATION_METHOD=mtls`.
 *
 * Browsers cannot present an uploaded certificate in the TLS handshake, so the console proves possession of the
 * certificate's private key at the application layer: it signs short-lived certificate assertions (compact JWS with
 * the certificate chain in `x5c`) and sends them as `Authorization: Certificate <assertion>`. The API verifies them
 * exactly like a TLS client certificate (`@forepath/identity/backend`, `verifyMtlsAssertion`).
 *
 * The private key is imported as a NON-EXTRACTABLE WebCrypto key and kept in IndexedDB: page scripts can sign with it
 * while the console is open, but its bytes can never be read back (unlike an API key in localStorage).
 */

/** `Authorization` scheme of certificate assertions. */
export const MTLS_AUTHORIZATION_SCHEME = 'Certificate';

/** JOSE `typ` of certificate assertions (must match the API). */
export const MTLS_ASSERTION_TYPE = 'cert-assertion+jwt';

/** Default assertion lifetime (seconds); the API accepts up to `MTLS_ASSERTION_MAX_LIFETIME` (default 300). */
export const MTLS_DEFAULT_ASSERTION_LIFETIME_SECONDS = 120;

/** A cached assertion is replaced when it has less than this many seconds left. */
const ASSERTION_REFRESH_MARGIN_SECONDS = 30;
/** Maximum certificates (leaf + intermediates) the API accepts. */
const MAX_CHAIN_LENGTH = 5;
const MIN_RSA_MODULUS_BITS = 2048;

export type MtlsSigningAlgorithm = 'RS256' | 'ES256' | 'ES384' | 'ES512' | 'EdDSA';

/** A client certificate ready to sign assertions. */
export interface MtlsCredential {
  /** Non-extractable signing key of the leaf certificate. */
  privateKey: CryptoKey;
  /** Standard base64 DER certificates, leaf first. */
  certificateChain: string[];
  algorithm: MtlsSigningAlgorithm;
  /** Leaf validity (ms since epoch). */
  notBefore: number;
  notAfter: number;
  /** Leaf subject common name, when present. */
  commonName?: string;
}

/** User-facing error of {@link importMtlsCredential} (wrong file, unsupported key, …). */
export class MtlsCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MtlsCredentialError';
  }
}

function getCrypto(cryptoImpl?: Crypto): Crypto {
  const resolved = cryptoImpl ?? (globalThis as { crypto?: Crypto }).crypto;

  if (!resolved?.subtle) {
    throw new MtlsCredentialError('Certificate sign-in requires a secure context (HTTPS) with WebCrypto support.');
  }

  return resolved;
}

// --- Encoding helpers -------------------------------------------------------------------------------------------

function bytesToBinary(bytes: Uint8Array): string {
  let binary = '';

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return binary;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes));
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Copies into a fresh ArrayBuffer-backed view (WebCrypto rejects SharedArrayBuffer / foreign realms' buffers). */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

// --- PEM / DER --------------------------------------------------------------------------------------------------

export interface PemBlock {
  label: string;
  der: Uint8Array;
}

/** All PEM blocks (`-----BEGIN <label>-----`) of a text file, in order. */
export function parsePemBlocks(text: string): PemBlock[] {
  const blocks: PemBlock[] = [];
  const pattern = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const body = match[2].replace(/\s+/g, '');

    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) {
      throw new MtlsCredentialError(`The ${match[1].toLowerCase()} block is not valid PEM.`);
    }

    blocks.push({ label: match[1], der: fromBase64(body) });
  }

  return blocks;
}

interface DerNode {
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first content byte. */
  contentStart: number;
  /** Offset after the last content byte. */
  end: number;
}

function readDerNode(bytes: Uint8Array, offset: number, limit = bytes.length): DerNode {
  if (offset + 2 > limit) {
    throw new MtlsCredentialError('The certificate is not valid DER.');
  }

  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let contentStart = offset + 2;

  if (length & 0x80) {
    const lengthBytes = length & 0x7f;

    if (lengthBytes === 0 || lengthBytes > 4 || contentStart + lengthBytes > limit) {
      throw new MtlsCredentialError('The certificate is not valid DER.');
    }

    length = 0;

    for (let index = 0; index < lengthBytes; index++) {
      length = length * 256 + bytes[contentStart + index];
    }

    contentStart += lengthBytes;
  }

  const end = contentStart + length;

  if (end > limit) {
    throw new MtlsCredentialError('The certificate is not valid DER.');
  }

  return { tag, start: offset, contentStart, end };
}

function derChildren(bytes: Uint8Array, node: DerNode): DerNode[] {
  const children: DerNode[] = [];
  let offset = node.contentStart;

  while (offset < node.end) {
    const child = readDerNode(bytes, offset, node.end);

    children.push(child);
    offset = child.end;
  }

  return children;
}

function hexOf(bytes: Uint8Array, node: DerNode): string {
  return Array.from(bytes.subarray(node.contentStart, node.end), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseDerTime(bytes: Uint8Array, node: DerNode): number {
  const text = String.fromCharCode(...bytes.subarray(node.contentStart, node.end));
  const match = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);

  if (!match || (node.tag !== 0x17 && node.tag !== 0x18)) {
    throw new MtlsCredentialError('The certificate validity is not readable.');
  }

  // RFC 5280: UTCTime years 50–99 are 19xx, 00–49 are 20xx.
  const year = node.tag === 0x17 ? (Number(match[1]) >= 50 ? 1900 : 2000) + Number(match[1]) : Number(match[1]);

  return Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

const OID_COMMON_NAME = '550403';
const OID_RSA_ENCRYPTION = '2a864886f70d010101';
const OID_EC_PUBLIC_KEY = '2a8648ce3d0201';
const OID_ED25519 = '2b6570';
const EC_CURVES: Record<string, { namedCurve: string; algorithm: MtlsSigningAlgorithm; hash: string }> = {
  '2a8648ce3d030107': { namedCurve: 'P-256', algorithm: 'ES256', hash: 'SHA-256' },
  '2b81040022': { namedCurve: 'P-384', algorithm: 'ES384', hash: 'SHA-384' },
  '2b81040023': { namedCurve: 'P-521', algorithm: 'ES512', hash: 'SHA-512' },
};

interface KeyAlgorithmParameters {
  algorithm: MtlsSigningAlgorithm;
  importParams: RsaHashedImportParams | EcKeyImportParams | Algorithm;
  signParams: RsaPssParams | EcdsaParams | Algorithm;
}

interface ParsedCertificate {
  der: Uint8Array;
  spki: Uint8Array;
  key: KeyAlgorithmParameters;
  notBefore: number;
  notAfter: number;
  commonName?: string;
}

/** Reads what the console needs from an X.509 certificate (no signature or chain validation: the API does that). */
export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const certificate = readDerNode(der, 0);
  const [tbs] = derChildren(der, certificate);

  if (certificate.tag !== 0x30 || !tbs || tbs.tag !== 0x30) {
    throw new MtlsCredentialError('The certificate is not valid DER.');
  }

  const fields = derChildren(der, tbs);
  const offset = fields[0]?.tag === 0xa0 ? 1 : 0;
  const validity = fields[offset + 3];
  const subject = fields[offset + 4];
  const spki = fields[offset + 5];

  if (!validity || !subject || !spki) {
    throw new MtlsCredentialError('The certificate is not valid DER.');
  }

  const [notBefore, notAfter] = derChildren(der, validity);
  let commonName: string | undefined;

  for (const relativeName of derChildren(der, subject)) {
    for (const attribute of derChildren(der, relativeName)) {
      const [oid, value] = derChildren(der, attribute);

      if (oid && value && hexOf(der, oid) === OID_COMMON_NAME) {
        commonName = new TextDecoder().decode(der.subarray(value.contentStart, value.end));
      }
    }
  }

  const [algorithmIdentifier] = derChildren(der, spki);
  const [algorithmOid, algorithmParameters] = derChildren(der, algorithmIdentifier);
  const keyOid = hexOf(der, algorithmOid);
  let key: KeyAlgorithmParameters;

  if (keyOid === OID_RSA_ENCRYPTION) {
    key = {
      algorithm: 'RS256',
      importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      signParams: { name: 'RSASSA-PKCS1-v1_5' },
    };
  } else if (keyOid === OID_EC_PUBLIC_KEY && algorithmParameters && EC_CURVES[hexOf(der, algorithmParameters)]) {
    const curve = EC_CURVES[hexOf(der, algorithmParameters)];

    key = {
      algorithm: curve.algorithm,
      importParams: { name: 'ECDSA', namedCurve: curve.namedCurve },
      signParams: { name: 'ECDSA', hash: curve.hash },
    };
  } else if (keyOid === OID_ED25519) {
    key = { algorithm: 'EdDSA', importParams: { name: 'Ed25519' }, signParams: { name: 'Ed25519' } };
  } else {
    throw new MtlsCredentialError(
      'Unsupported certificate key. Use an RSA (2048 bits or more), ECDSA (P-256, P-384, P-521) or Ed25519 key.',
    );
  }

  return {
    der: der.subarray(certificate.start, certificate.end),
    spki: der.subarray(spki.start, spki.end),
    key,
    notBefore: parseDerTime(der, notBefore),
    notAfter: parseDerTime(der, notAfter),
    ...(commonName ? { commonName } : {}),
  };
}

// --- Import -----------------------------------------------------------------------------------------------------

function findPrivateKey(blocks: PemBlock[]): Uint8Array {
  const labels = blocks.map((block) => block.label);

  if (labels.includes('ENCRYPTED PRIVATE KEY')) {
    throw new MtlsCredentialError(
      'Encrypted private keys are not supported. Decrypt it first: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pk8.pem',
    );
  }

  if (labels.includes('RSA PRIVATE KEY') || labels.includes('EC PRIVATE KEY')) {
    throw new MtlsCredentialError(
      'Convert the private key to PKCS#8 first: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pk8.pem',
    );
  }

  const keys = blocks.filter((block) => block.label === 'PRIVATE KEY');

  if (keys.length === 0) {
    throw new MtlsCredentialError(
      'No private key found. Select a PEM file containing the certificate and its private key, or add the key file.',
    );
  }

  if (keys.length > 1) {
    throw new MtlsCredentialError('Select exactly one private key.');
  }

  return keys[0].der;
}

/**
 * Imports a client certificate for certificate sign-in.
 *
 * @param certificateText PEM with the client certificate (and optionally intermediates and the PKCS#8 private key)
 * @param privateKeyText PEM with the PKCS#8 private key, when it is not part of `certificateText`
 * @throws MtlsCredentialError with a user-facing message
 */
export async function importMtlsCredential(
  certificateText: string,
  privateKeyText?: string,
  options: { crypto?: Crypto; now?: Date } = {},
): Promise<MtlsCredential> {
  const { subtle } = getCrypto(options.crypto);
  const now = (options.now ?? new Date()).getTime();
  const certificateBlocks = parsePemBlocks(certificateText);
  const keyBlocks = [...certificateBlocks, ...(privateKeyText ? parsePemBlocks(privateKeyText) : [])];
  const certificates = certificateBlocks.filter((block) => block.label === 'CERTIFICATE');

  if (certificates.length === 0) {
    throw new MtlsCredentialError(
      'No certificate found. Select a PEM file (.pem / .crt) containing "BEGIN CERTIFICATE". Convert PKCS#12 files with: openssl pkcs12 -in client.p12 -nodes -out client.pem',
    );
  }

  if (certificates.length > MAX_CHAIN_LENGTH) {
    throw new MtlsCredentialError(`The certificate file may contain at most ${MAX_CHAIN_LENGTH} certificates.`);
  }

  const privateKeyDer = findPrivateKey(keyBlocks);
  const parsed = certificates.map((block) => parseCertificate(block.der));
  const challenge = getCrypto(options.crypto).getRandomValues(new Uint8Array(32));

  // The leaf is the certificate whose public key belongs to the private key (bundles are not always leaf-first).
  for (const [index, certificate] of parsed.entries()) {
    let privateKey: CryptoKey;
    let publicKey: CryptoKey;

    try {
      privateKey = await subtle.importKey('pkcs8', bufferOf(privateKeyDer), certificate.key.importParams, false, [
        'sign',
      ]);
      publicKey = await subtle.importKey('spki', bufferOf(certificate.spki), certificate.key.importParams, true, [
        'verify',
      ]);
    } catch {
      continue;
    }

    const signature = await subtle.sign(certificate.key.signParams, privateKey, bufferOf(challenge));

    if (!(await subtle.verify(certificate.key.signParams, publicKey, signature, bufferOf(challenge)))) {
      continue;
    }

    const modulusLength = (publicKey.algorithm as RsaHashedKeyAlgorithm).modulusLength;

    if (certificate.key.algorithm === 'RS256' && modulusLength < MIN_RSA_MODULUS_BITS) {
      throw new MtlsCredentialError(`RSA keys must have at least ${MIN_RSA_MODULUS_BITS} bits.`);
    }

    if (certificate.notAfter < now) {
      throw new MtlsCredentialError('The certificate has expired.');
    }

    if (certificate.notBefore > now) {
      throw new MtlsCredentialError('The certificate is not valid yet.');
    }

    const chain = [certificate, ...parsed.filter((_, other) => other !== index)];

    return {
      privateKey,
      certificateChain: chain.map((entry) => toBase64(entry.der)),
      algorithm: certificate.key.algorithm,
      notBefore: certificate.notBefore,
      notAfter: certificate.notAfter,
      ...(certificate.commonName ? { commonName: certificate.commonName } : {}),
    };
  }

  throw new MtlsCredentialError('The private key does not belong to the certificate.');
}

// --- Assertions -------------------------------------------------------------------------------------------------

function signParamsFor(algorithm: MtlsSigningAlgorithm): Algorithm | RsaPssParams | EcdsaParams {
  switch (algorithm) {
    case 'RS256':
      return { name: 'RSASSA-PKCS1-v1_5' };
    case 'ES256':
      return { name: 'ECDSA', hash: 'SHA-256' } as EcdsaParams;
    case 'ES384':
      return { name: 'ECDSA', hash: 'SHA-384' } as EcdsaParams;
    case 'ES512':
      return { name: 'ECDSA', hash: 'SHA-512' } as EcdsaParams;
    case 'EdDSA':
      return { name: 'Ed25519' };
  }
}

export interface MtlsAssertionOptions {
  /** Lifetime in seconds (default {@link MTLS_DEFAULT_ASSERTION_LIFETIME_SECONDS}). */
  lifetimeSeconds?: number;
  /** `aud` claim (when the API sets `MTLS_ASSERTION_AUDIENCE`). */
  audience?: string;
  now?: Date;
  crypto?: Crypto;
}

/** Signs a certificate assertion (compact JWS) with the credential's private key. */
export async function createMtlsAssertion(
  credential: MtlsCredential,
  options: MtlsAssertionOptions = {},
): Promise<string> {
  const cryptoImpl = getCrypto(options.crypto);
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const jti = Array.from(cryptoImpl.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const header = { alg: credential.algorithm, typ: MTLS_ASSERTION_TYPE, x5c: credential.certificateChain };
  const payload = {
    iat,
    exp: iat + (options.lifetimeSeconds ?? MTLS_DEFAULT_ASSERTION_LIFETIME_SECONDS),
    jti,
    ...(options.audience ? { aud: options.audience } : {}),
  };
  const signingInput = `${toBase64Url(utf8(JSON.stringify(header)))}.${toBase64Url(utf8(JSON.stringify(payload)))}`;
  const signature = await cryptoImpl.subtle.sign(
    signParamsFor(credential.algorithm),
    credential.privateKey,
    bufferOf(utf8(signingInput)),
  );

  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

// --- Storage ----------------------------------------------------------------------------------------------------

const DB_NAME = 'forepath-identity';
const DB_STORE = 'credentials';
const DB_KEY = 'mtls';
/** In-memory copy: the source of truth when IndexedDB is unavailable (SSR, private mode), a cache otherwise. */
let memoryCredential: MtlsCredential | null | undefined;
let cachedAssertion: { credential: MtlsCredential; header: string; exp: number; audience?: string } | null = null;
let pendingAssertion: Promise<string | null> | null = null;

function getIndexedDb(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const factory = getIndexedDb();

  if (!factory) {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }

  return new Promise<T>((resolve, reject) => {
    const open = factory.open(DB_NAME, 1);

    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(DB_STORE)) {
        open.result.createObjectStore(DB_STORE);
      }
    };

    open.onerror = () => reject(open.error);

    open.onsuccess = () => {
      const db = open.result;

      try {
        const request = run(db.transaction(DB_STORE, mode).objectStore(DB_STORE));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (error) {
        reject(error);
      } finally {
        db.close();
      }
    };
  });
}

function isMtlsCredential(value: unknown): value is MtlsCredential {
  const candidate = value as Partial<MtlsCredential> | null;
  const key = candidate?.privateKey as Partial<CryptoKey> | undefined;

  return (
    !!candidate &&
    typeof candidate === 'object' &&
    !!key &&
    key.type === 'private' &&
    Array.isArray(key.usages) &&
    key.usages.includes('sign') &&
    Array.isArray(candidate.certificateChain) &&
    typeof candidate.algorithm === 'string' &&
    typeof candidate.notAfter === 'number'
  );
}

/** Persists the credential (IndexedDB; in memory only when IndexedDB is unavailable). */
export async function saveMtlsCredential(credential: MtlsCredential): Promise<void> {
  memoryCredential = credential;
  cachedAssertion = null;

  try {
    await withStore('readwrite', (store) => store.put(credential, DB_KEY));
  } catch {
    // Keep the in-memory credential for this page session.
  }
}

/** The stored credential, or null. */
export async function loadMtlsCredential(): Promise<MtlsCredential | null> {
  if (memoryCredential !== undefined) {
    return memoryCredential;
  }

  try {
    const stored = await withStore<unknown>('readonly', (store) => store.get(DB_KEY));

    memoryCredential = isMtlsCredential(stored) ? stored : null;
  } catch {
    memoryCredential = null;
  }

  return memoryCredential;
}

/** Removes the stored credential (logout, rejected certificate). */
export async function clearMtlsCredential(): Promise<void> {
  memoryCredential = null;
  cachedAssertion = null;
  pendingAssertion = null;

  try {
    await withStore('readwrite', (store) => store.delete(DB_KEY));
  } catch {
    // Nothing persisted.
  }
}

/** Whether a currently valid credential is stored. */
export async function hasMtlsCredential(now: Date = new Date()): Promise<boolean> {
  const credential = await loadMtlsCredential();

  return !!credential && credential.notAfter > now.getTime();
}

/**
 * `Authorization` value for API and socket requests in mtls mode: a cached assertion while it is valid for at least
 * another 30 seconds, otherwise a freshly signed one. Null without a (valid) stored credential.
 */
export async function getMtlsAuthorizationHeader(
  options: Omit<MtlsAssertionOptions, 'now'> & { now?: Date } = {},
): Promise<string | null> {
  const now = options.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const credential = await loadMtlsCredential();

  if (!credential || credential.notAfter <= now.getTime()) {
    return null;
  }

  if (
    cachedAssertion &&
    cachedAssertion.credential === credential &&
    cachedAssertion.audience === options.audience &&
    cachedAssertion.exp - nowSeconds > ASSERTION_REFRESH_MARGIN_SECONDS
  ) {
    return cachedAssertion.header;
  }

  // Concurrent requests share one signature.
  pendingAssertion ??= createMtlsAssertion(credential, { ...options, now })
    .then((assertion) => {
      const lifetime = options.lifetimeSeconds ?? MTLS_DEFAULT_ASSERTION_LIFETIME_SECONDS;
      const header = `${MTLS_AUTHORIZATION_SCHEME} ${assertion}`;

      cachedAssertion = { credential, header, exp: nowSeconds + lifetime, audience: options.audience };

      return header;
    })
    .catch(() => null)
    .finally(() => {
      pendingAssertion = null;
    });

  return pendingAssertion;
}

/** Resets module state between unit tests. */
export function resetMtlsCredentialStateForTests(): void {
  memoryCredential = undefined;
  cachedAssertion = null;
  pendingAssertion = null;
}
