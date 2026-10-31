import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * age v1 (https://age-encryption.org/v1) with native X25519 recipients, on `node:crypto` only. Used for the cluster's
 * SOPS identity (3.29): SOPS wraps a file's data key as an armored age file per recipient.
 *
 * Supported: X25519 identities / recipients (Bech32 `AGE-SECRET-KEY-1…` / `age1…`), binary and ASCII-armored files.
 * Other stanza types (scrypt, ssh-*, plugins, post-quantum, grease) are skipped when decrypting; a file without a
 * matching X25519 stanza fails with "no identity matched".
 */

const VERSION_LINE = 'age-encryption.org/v1';
const X25519_LABEL = Buffer.from('age-encryption.org/v1/X25519');
const ARMOR_BEGIN = '-----BEGIN AGE ENCRYPTED FILE-----';
const ARMOR_END = '-----END AGE ENCRYPTED FILE-----';
const ARMOR_COLUMNS = 64;
const BODY_COLUMNS = 64;
const FILE_KEY_BYTES = 16;
const PAYLOAD_NONCE_BYTES = 16;
const CHUNK_BYTES = 64 * 1024;
const TAG_BYTES = 16;
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const IDENTITY_HRP = 'age-secret-key-';
const RECIPIENT_HRP = 'age';

// ---------------------------------------------------------------------------------------------------------------
// Bech32 (BIP-173). age uses plain Bech32 (not Bech32m) and doesn't apply the 90 character limit.
// ---------------------------------------------------------------------------------------------------------------

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;

  for (const value of values) {
    const top = chk >>> 25;

    chk = ((chk & 0x1ffffff) << 5) ^ value;

    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= BECH32_GENERATOR[i];
  }

  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];

  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);

  out.push(0);

  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);

  return out;
}

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];

    if (value < 0 || value >> from !== 0) throw new Error('invalid bech32 data');

    acc = (acc << from) | value;
    bits += from;

    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }

    acc &= (1 << bits) - 1;
  }

  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || ((acc << (to - bits)) & max) !== 0) {
    throw new Error('invalid bech32 padding');
  }

  return out;
}

/** Encodes bytes as lowercase Bech32 with the given human-readable part. */
export function bech32Encode(hrp: string, data: Buffer): string {
  const lower = hrp.toLowerCase();

  if (lower.length === 0 || !/^[\x21-\x7e]+$/.test(lower)) throw new Error('invalid bech32 prefix');

  const words = convertBits(data, 8, 5, true);
  const chk = polymod([...hrpExpand(lower), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (chk >>> (5 * (5 - i))) & 31);

  return `${lower}1${[...words, ...checksum].map((w) => BECH32_CHARSET[w]).join('')}`;
}

/** Decodes a Bech32 string (all lowercase or all uppercase); the returned prefix is lowercase. */
export function bech32Decode(text: string): { hrp: string; data: Buffer } {
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) throw new Error('invalid bech32: mixed case');

  const lower = text.toLowerCase();
  const separator = lower.lastIndexOf('1');

  if (separator < 1 || separator + 7 > lower.length) throw new Error('invalid bech32: bad separator position');

  const hrp = lower.slice(0, separator);

  if (!/^[\x21-\x7e]+$/.test(hrp)) throw new Error('invalid bech32 prefix');

  const words: number[] = [];

  for (const char of lower.slice(separator + 1)) {
    const word = BECH32_CHARSET.indexOf(char);

    if (word < 0) throw new Error('invalid bech32 character');

    words.push(word);
  }

  if (polymod([...hrpExpand(hrp), ...words]) !== 1) throw new Error('invalid bech32 checksum');

  return { hrp, data: Buffer.from(convertBits(words.slice(0, -6), 5, 8, false)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------------------------

export interface AgeKeyPair {
  /** `AGE-SECRET-KEY-1…` (secret). */
  identity: string;
  /** `age1…` (public). */
  recipient: string;
}

function decodeIdentity(identity: string): Buffer {
  let decoded: { hrp: string; data: Buffer };

  try {
    decoded = bech32Decode(identity.trim());
  } catch {
    throw new Error('invalid age identity');
  }

  if (decoded.hrp !== IDENTITY_HRP || decoded.data.length !== 32) throw new Error('invalid age identity');

  return decoded.data;
}

function decodeRecipient(recipient: string): Buffer {
  let decoded: { hrp: string; data: Buffer };

  try {
    decoded = bech32Decode(recipient.trim());
  } catch {
    throw new Error(`invalid age recipient: ${recipient}`);
  }

  if (decoded.hrp !== RECIPIENT_HRP || decoded.data.length !== 32) {
    throw new Error(`invalid age recipient: ${recipient}`);
  }

  return decoded.data;
}

function privateKeyObject(raw: Buffer): KeyObject {
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: 'der', type: 'pkcs8' });
}

function publicKeyObject(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

function rawPublic(key: KeyObject): Buffer {
  return (key.export({ format: 'der', type: 'spki' }) as Buffer).subarray(SPKI_PREFIX.length);
}

function rawPrivate(key: KeyObject): Buffer {
  return (key.export({ format: 'der', type: 'pkcs8' }) as Buffer).subarray(PKCS8_PREFIX.length);
}

/** Encodes a raw 32-byte X25519 scalar as an age identity (`AGE-SECRET-KEY-1…`). */
export function ageIdentityFromRaw(raw: Buffer): string {
  if (raw.length !== 32) throw new Error('invalid age identity');

  return bech32Encode(IDENTITY_HRP, raw).toUpperCase();
}

export function generateAgeIdentity(): AgeKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const raw = rawPrivate(privateKey);

  try {
    return { identity: ageIdentityFromRaw(raw), recipient: bech32Encode(RECIPIENT_HRP, rawPublic(publicKey)) };
  } finally {
    raw.fill(0);
  }
}

/** The public recipient (`age1…`) of an identity. */
export function ageRecipientOf(identity: string): string {
  const raw = decodeIdentity(identity);

  try {
    return bech32Encode(RECIPIENT_HRP, rawPublic(createPublicKey(privateKeyObject(raw))));
  } finally {
    raw.fill(0);
  }
}

export function isAgeRecipient(text: string): boolean {
  try {
    decodeRecipient(text);

    return true;
  } catch {
    return false;
  }
}

export function isAgeIdentity(text: string): boolean {
  try {
    decodeIdentity(text).fill(0);

    return true;
  } catch {
    return false;
  }
}

/** Identities from an age key file (`age-keygen` output): one per line, `#` comments and blank lines ignored. */
export function parseAgeIdentities(text: string): string[] {
  const identities = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  for (const identity of identities) if (!isAgeIdentity(identity)) throw new Error('invalid age identity in key file');

  return identities;
}

// ---------------------------------------------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------------------------------------------

function b64NoPad(data: Buffer): string {
  return data.toString('base64').replace(/=+$/, '');
}

/** Strict, canonical base64 without padding (as age requires). */
function decodeB64NoPad(text: string, what: string): Buffer {
  if (!/^[A-Za-z0-9+/]*$/.test(text) || text.length % 4 === 1) throw new Error(`invalid age file: bad ${what}`);

  const data = Buffer.from(text, 'base64');

  if (b64NoPad(data) !== text) throw new Error(`invalid age file: non-canonical ${what}`);

  return data;
}

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer | string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, typeof info === 'string' ? Buffer.from(info) : info, length));
}

function chachaSeal(key: Buffer, nonce: Buffer, plaintext: Buffer): Buffer {
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_BYTES });

  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** Returns null when authentication fails. */
function chachaOpen(key: Buffer, nonce: Buffer, sealed: Buffer): Buffer | null {
  if (sealed.length < TAG_BYTES) return null;

  const decipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_BYTES });

  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));

  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Armor
// ---------------------------------------------------------------------------------------------------------------

export function isAgeArmored(file: Buffer | string): boolean {
  const text = typeof file === 'string' ? file : file.subarray(0, 1024).toString('latin1');

  return text.trimStart().startsWith(ARMOR_BEGIN);
}

/** PEM-style armor: padded base64 in 64 column lines between BEGIN / END lines. */
export function ageArmor(file: Buffer): string {
  const b64 = file.toString('base64');
  const lines: string[] = [];

  for (let i = 0; i < b64.length; i += ARMOR_COLUMNS) lines.push(b64.slice(i, i + ARMOR_COLUMNS));

  return `${ARMOR_BEGIN}\n${lines.join('\n')}${lines.length ? '\n' : ''}${ARMOR_END}\n`;
}

export function ageDearmor(text: string): Buffer {
  const lines = text.trim().split(/\r?\n/);

  if (lines.length < 2 || lines[0] !== ARMOR_BEGIN || lines[lines.length - 1] !== ARMOR_END) {
    throw new Error('invalid age armor: missing begin / end line');
  }

  const body = lines.slice(1, -1);

  body.forEach((line, i) => {
    const last = i === body.length - 1;

    if (line.length === 0 || line.length > ARMOR_COLUMNS || (!last && line.length !== ARMOR_COLUMNS)) {
      throw new Error('invalid age armor: bad line length');
    }
  });

  const b64 = body.join('');

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) throw new Error('invalid age armor: bad base64');

  const data = Buffer.from(b64, 'base64');

  if (data.toString('base64') !== b64) throw new Error('invalid age armor: non-canonical base64');

  return data;
}

// ---------------------------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------------------------

interface Stanza {
  type: string;
  args: string[];
  body: Buffer;
}

interface Header {
  stanzas: Stanza[];
  /** Header bytes up to and including `---`. */
  macInput: Buffer;
  mac: Buffer;
  payloadOffset: number;
}

function readLine(file: Buffer, offset: number): { line: string; next: number } {
  const end = file.indexOf(0x0a, offset);

  if (end < 0) throw new Error('invalid age file: truncated header');

  const raw = file.subarray(offset, end);

  for (const byte of raw) if (byte < 0x20 || byte > 0x7e) throw new Error('invalid age file: non-ASCII header');

  return { line: raw.toString('latin1'), next: end + 1 };
}

function parseHeader(file: Buffer): Header {
  let { line, next } = readLine(file, 0);

  if (line !== VERSION_LINE) throw new Error('invalid age file: unsupported version');

  const stanzas: Stanza[] = [];

  for (;;) {
    const start = next;

    ({ line, next } = readLine(file, next));

    if (line.startsWith('--- ')) {
      if (stanzas.length === 0) throw new Error('invalid age file: no recipient stanzas');

      const mac = decodeB64NoPad(line.slice(4), 'header MAC');

      if (mac.length !== 32) throw new Error('invalid age file: bad header MAC');

      return { stanzas, macInput: file.subarray(0, start + 3), mac, payloadOffset: next };
    }

    if (!line.startsWith('-> ')) throw new Error('invalid age file: malformed header');

    const args = line.slice(3).split(' ');

    if (args.some((arg) => arg.length === 0 || !/^[\x21-\x7e]+$/.test(arg))) {
      throw new Error('invalid age file: malformed stanza');
    }

    const bodyLines: string[] = [];

    for (;;) {
      ({ line, next } = readLine(file, next));

      if (line.length > BODY_COLUMNS) throw new Error('invalid age file: stanza body line too long');

      bodyLines.push(line);

      if (line.length < BODY_COLUMNS) break;
    }

    stanzas.push({ type: args[0], args: args.slice(1), body: decodeB64NoPad(bodyLines.join(''), 'stanza body') });
  }
}

function wrapBody(body: Buffer): string {
  const b64 = b64NoPad(body);
  const lines: string[] = [];

  for (let i = 0; i < b64.length; i += BODY_COLUMNS) lines.push(b64.slice(i, i + BODY_COLUMNS));

  // The final line is always shorter than 64 columns (possibly empty).
  if (b64.length % BODY_COLUMNS === 0) lines.push('');

  return lines.join('\n');
}

function headerMac(fileKey: Buffer, macInput: Buffer): Buffer {
  const key = hkdf(fileKey, Buffer.alloc(0), 'header');

  try {
    return createHmac('sha256', key).update(macInput).digest();
  } finally {
    key.fill(0);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// X25519 recipient stanzas
// ---------------------------------------------------------------------------------------------------------------

function x25519Shared(privateKey: KeyObject, publicRaw: Buffer): Buffer {
  let shared: Buffer;

  try {
    shared = diffieHellman({ privateKey, publicKey: publicKeyObject(publicRaw) });
  } catch {
    // OpenSSL refuses low-order points (all-zero shared secret).
    throw new Error('invalid X25519 stanza: low-order point');
  }

  if (shared.every((byte) => byte === 0)) throw new Error('invalid X25519 stanza: low-order point');

  return shared;
}

function wrapX25519(fileKey: Buffer, recipientRaw: Buffer): Stanza {
  const ephemeral = generateKeyPairSync('x25519');
  const share = rawPublic(ephemeral.publicKey);
  const shared = x25519Shared(ephemeral.privateKey, recipientRaw);
  const wrapKey = hkdf(shared, Buffer.concat([share, recipientRaw]), X25519_LABEL);

  try {
    return { type: 'X25519', args: [b64NoPad(share)], body: chachaSeal(wrapKey, Buffer.alloc(12), fileKey) };
  } finally {
    wrapKey.fill(0);
    shared.fill(0);
  }
}

function unwrapX25519(stanza: Stanza, identityRaw: Buffer): Buffer | null {
  if (stanza.args.length !== 1) throw new Error('invalid X25519 stanza');

  const share = decodeB64NoPad(stanza.args[0], 'X25519 share');

  if (share.length !== 32 || stanza.body.length !== FILE_KEY_BYTES + TAG_BYTES)
    throw new Error('invalid X25519 stanza');

  const privateKey = privateKeyObject(identityRaw);
  const recipientRaw = rawPublic(createPublicKey(privateKey));
  const shared = x25519Shared(privateKey, share);
  const wrapKey = hkdf(shared, Buffer.concat([share, recipientRaw]), X25519_LABEL);

  try {
    return chachaOpen(wrapKey, Buffer.alloc(12), stanza.body);
  } finally {
    wrapKey.fill(0);
    shared.fill(0);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Payload (STREAM)
// ---------------------------------------------------------------------------------------------------------------

function chunkNonce(counter: number, last: boolean): Buffer {
  const nonce = Buffer.alloc(12);

  // 11-byte big-endian counter; 2^48 chunks are far beyond any file we handle.
  nonce.writeUIntBE(counter, 5, 6);
  nonce[11] = last ? 1 : 0;

  return nonce;
}

function encryptPayload(fileKey: Buffer, plaintext: Buffer): Buffer {
  const nonce = randomBytes(PAYLOAD_NONCE_BYTES);
  const key = hkdf(fileKey, nonce, 'payload');
  const parts: Buffer[] = [nonce];

  try {
    const chunks = Math.max(1, Math.ceil(plaintext.length / CHUNK_BYTES));

    for (let i = 0; i < chunks; i++) {
      parts.push(
        chachaSeal(key, chunkNonce(i, i === chunks - 1), plaintext.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)),
      );
    }

    return Buffer.concat(parts);
  } finally {
    key.fill(0);
  }
}

function decryptPayload(fileKey: Buffer, payload: Buffer): Buffer {
  if (payload.length < PAYLOAD_NONCE_BYTES + TAG_BYTES) throw new Error('invalid age file: truncated payload');

  const key = hkdf(fileKey, payload.subarray(0, PAYLOAD_NONCE_BYTES), 'payload');
  const ciphertext = payload.subarray(PAYLOAD_NONCE_BYTES);
  const sealedChunk = CHUNK_BYTES + TAG_BYTES;
  const chunks = Math.ceil(ciphertext.length / sealedChunk);
  const parts: Buffer[] = [];

  try {
    for (let i = 0; i < chunks; i++) {
      const last = i === chunks - 1;
      const sealed = ciphertext.subarray(i * sealedChunk, (i + 1) * sealedChunk);

      if (sealed.length < TAG_BYTES) throw new Error('invalid age file: truncated payload');

      if (last && i > 0 && sealed.length === TAG_BYTES) throw new Error('invalid age file: empty final chunk');

      const plain = chachaOpen(key, chunkNonce(i, last), sealed);

      if (!plain) {
        // A full-size chunk that isn't marked final means the file was cut off at a chunk boundary.
        if (last && sealed.length === sealedChunk && chachaOpen(key, chunkNonce(i, false), sealed)) {
          throw new Error('invalid age file: truncated payload');
        }

        if (!last && chachaOpen(key, chunkNonce(i, true), sealed)) {
          throw new Error('invalid age file: trailing data after final chunk');
        }

        throw new Error('invalid age file: payload authentication failed');
      }

      parts.push(plain);
    }

    return Buffer.concat(parts);
  } finally {
    key.fill(0);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------

export interface AgeEncryptOptions {
  /** ASCII armor (PEM-style); the result is then ASCII text in a Buffer. */
  armor?: boolean;
}

/** Encrypts to one or more X25519 recipients (`age1…`). */
export function ageEncrypt(plaintext: Buffer | string, recipients: string[], options: AgeEncryptOptions = {}): Buffer {
  if (recipients.length === 0) throw new Error('at least one age recipient is required');

  const recipientKeys = recipients.map(decodeRecipient);
  const fileKey = randomBytes(FILE_KEY_BYTES);

  try {
    let header = `${VERSION_LINE}\n`;

    for (const recipient of recipientKeys) {
      const stanza = wrapX25519(fileKey, recipient);

      header += `-> ${[stanza.type, ...stanza.args].join(' ')}\n${wrapBody(stanza.body)}\n`;
    }

    header += '---';

    const mac = headerMac(fileKey, Buffer.from(header, 'latin1'));
    const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
    const file = Buffer.concat([Buffer.from(`${header} ${b64NoPad(mac)}\n`, 'latin1'), encryptPayload(fileKey, data)]);

    return options.armor ? Buffer.from(ageArmor(file), 'latin1') : file;
  } finally {
    fileKey.fill(0);
  }
}

/** Decrypts a binary or armored age file with the first matching X25519 identity (`AGE-SECRET-KEY-1…`). */
export function ageDecrypt(file: Buffer | string, identities: string[]): Buffer {
  const binary = isAgeArmored(file)
    ? ageDearmor(typeof file === 'string' ? file : file.toString('latin1'))
    : typeof file === 'string'
      ? Buffer.from(file, 'latin1')
      : file;
  const header = parseHeader(binary);
  const stanzas = header.stanzas.filter((stanza) => stanza.type === 'X25519');
  let fileKey: Buffer | null = null;

  for (const identity of identities) {
    const raw = decodeIdentity(identity);

    try {
      for (const stanza of stanzas) {
        fileKey = unwrapX25519(stanza, raw);

        if (fileKey) break;
      }
    } finally {
      raw.fill(0);
    }

    if (fileKey) break;
  }

  if (!fileKey) throw new Error('age: no identity matched any of the file recipients');

  try {
    if (fileKey.length !== FILE_KEY_BYTES) throw new Error('invalid age file: bad file key');

    if (!timingSafeEqual(headerMac(fileKey, header.macInput), header.mac)) {
      throw new Error('invalid age file: header MAC mismatch');
    }

    return decryptPayload(fileKey, binary.subarray(header.payloadOffset));
  } finally {
    fileKey.fill(0);
  }
}
