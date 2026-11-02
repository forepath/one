import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';

import {
  type Document,
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  type Node,
  parseAllDocuments,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';

import { ageDecrypt, ageRecipientOf } from './age';

/**
 * SOPS (https://github.com/getsops/sops) decryption for YAML files encrypted to age recipients (3.29), on
 * `node:crypto` only. Mirrors SOPS 3.x:
 *
 * - The data key (32 bytes) is an armored age file per recipient in `sops.age[].enc`.
 * - Every value is `ENC[AES256_GCM,data:…,iv:…,tag:…,type:…]` (AES-256-GCM, 32-byte IV), with the value's path as
 *   additional data: the mapping keys from the document root joined with `:` plus a trailing `:` (list positions
 *   don't add to the path).
 * - Which values are encrypted follows `unencrypted_suffix` / `encrypted_suffix` / `unencrypted_regex` /
 *   `encrypted_regex`, applied to every key on the path.
 * - The MAC is SHA-512 (uppercase hex) over the plaintext values in document order (all non-null values, or only
 *   the encrypted ones with `mac_only_encrypted`), stored encrypted with `lastmodified` (RFC 3339) as additional data.
 * - Comments are encrypted as `#ENC[…,type:comment]` and not covered by the MAC.
 *
 * Multi-document files are supported (one data key and one MAC across all documents, as SOPS writes them).
 * Not supported: KMS / PGP / Vault only files, Shamir key groups (`key_groups` / `shamir_threshold`), the
 * comment-based rules (`unencrypted_comment_regex` / `encrypted_comment_regex`), YAML aliases, non-string keys.
 */

const ENC_PATTERN =
  /^ENC\[AES256_GCM,data:([A-Za-z0-9+/]*={0,2}),iv:([A-Za-z0-9+/]+={0,2}),tag:([A-Za-z0-9+/]+={0,2}),type:(str|int|float|bool|bytes|time|comment)\]$/;
const ENC_COMMENT_LINE = /^\s*(ENC\[AES256_GCM,[^\]]*\])\s*$/;
const DATA_KEY_BYTES = 32;
/** SOPS seeds the hash with SHA-256("sops") when `mac_only_encrypted` is set, so the two MAC modes never collide. */
const MAC_ONLY_ENCRYPTED_INIT = Buffer.from('8a3fd2ad54ce66527b1034f3d147be0b0b975b3bf44f72c6fdadec8176f27d69', 'hex');

type EncType = 'str' | 'int' | 'float' | 'bool' | 'bytes' | 'time' | 'comment';

export interface SopsMetadata {
  age: { recipient: string; enc: string }[];
  lastModified: string;
  mac: string;
  version?: string;
  macOnlyEncrypted: boolean;
  unencryptedSuffix?: string;
  encryptedSuffix?: string;
  unencryptedRegex?: string;
  encryptedRegex?: string;
}

export interface SopsDecryptResult {
  /** The decrypted YAML without the `sops` block (formatting and comments of the encrypted file are kept). */
  yaml: string;
  /** The decrypted documents as plain JS values (one per YAML document). */
  documents: unknown[];
}

class SopsError extends Error {
  constructor(message: string) {
    super(`sops: ${message}`);
    this.name = 'SopsError';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------

function parseDocuments(text: string): Document.Parsed[] {
  const parsed = parseAllDocuments(text, { uniqueKeys: true });
  const documents = Array.isArray(parsed) ? parsed : [];

  for (const doc of documents) if (doc.errors.length > 0) throw new SopsError('invalid YAML');

  return documents;
}

function sopsPairIndex(doc: Document): number {
  if (!isMap(doc.contents)) return -1;

  return doc.contents.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === 'sops');
}

/** True if the text is a YAML file with a SOPS metadata block. Never throws. */
export function isSopsDocument(text: string): boolean {
  if (!/^sops:/m.test(text)) return false;

  try {
    return parseDocuments(text).some((doc) => {
      const index = sopsPairIndex(doc);
      const value = index < 0 ? null : (doc.contents as YAMLMap).items[index].value;

      return isMap(value) && value.has('mac') && value.has('lastmodified');
    });
  } catch {
    return false;
  }
}

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];

  if (value === undefined || value === null || value === '') return undefined;

  if (typeof value !== 'string') throw new SopsError(`invalid metadata field ${key}`);

  return value;
}

function readMetadata(raw: unknown): SopsMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SopsError('invalid metadata block');

  const meta = raw as Record<string, unknown>;

  for (const unsupported of [
    'key_groups',
    'shamir_threshold',
    'unencrypted_comment_regex',
    'encrypted_comment_regex',
  ]) {
    if (meta[unsupported] !== undefined && meta[unsupported] !== null) {
      throw new SopsError(`unsupported metadata field ${unsupported}`);
    }
  }

  const version = meta['version'] === undefined ? undefined : String(meta['version']);

  if (version !== undefined && !/^3\./.test(version)) throw new SopsError(`unsupported SOPS version ${version}`);

  const age = Array.isArray(meta['age']) ? meta['age'] : [];
  const entries = age.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;

    if (typeof item['enc'] !== 'string') throw new SopsError('invalid age entry in metadata');

    return { recipient: typeof item['recipient'] === 'string' ? item['recipient'] : '', enc: item['enc'] };
  });

  if (entries.length === 0) throw new SopsError('file has no age recipients (only age is supported)');

  const lastModified = meta['lastmodified'];
  const mac = meta['mac'];

  if (typeof lastModified !== 'string') throw new SopsError('metadata has no lastmodified');

  if (typeof mac !== 'string' || mac === '') throw new SopsError('file has no MAC');

  const result: SopsMetadata = {
    age: entries,
    lastModified,
    mac,
    version,
    macOnlyEncrypted: meta['mac_only_encrypted'] === true,
    unencryptedSuffix: optionalString(meta, 'unencrypted_suffix'),
    encryptedSuffix: optionalString(meta, 'encrypted_suffix'),
    unencryptedRegex: optionalString(meta, 'unencrypted_regex'),
    encryptedRegex: optionalString(meta, 'encrypted_regex'),
  };
  const rules = [result.unencryptedSuffix, result.encryptedSuffix, result.unencryptedRegex, result.encryptedRegex];

  if (rules.filter((rule) => rule !== undefined).length > 1) throw new SopsError('conflicting encryption rules');

  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------------------------

/** Go's `time.Parse(RFC3339)` + `Format(RFC3339)`: drops fractional seconds, a zero offset becomes `Z`. */
export function sopsMacAad(lastModified: string): string {
  const match = /^(\d{4}-\d\d-\d\d[Tt]\d\d:\d\d:\d\d)(?:\.\d+)?([Zz]|[+-]\d\d:\d\d)$/.exec(lastModified.trim());

  if (!match) throw new SopsError('invalid lastmodified timestamp');

  const zone = /^[Zz]$|^[+-]00:00$/.test(match[2]) ? 'Z' : match[2];

  return `${match[1].toUpperCase()}${zone}`;
}

/** Go's `strconv.FormatFloat(v, 'f', -1, 64)`: shortest round-trip digits, never an exponent. */
export function goFormatFloat(value: number): string {
  if (Number.isNaN(value)) return 'NaN';

  if (value === Infinity) return '+Inf';

  if (value === -Infinity) return '-Inf';

  if (value === 0) return Object.is(value, -0) ? '-0' : '0';

  const [mantissa, exponentText] = Math.abs(value).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const point = Number(exponentText) + 1;
  const sign = value < 0 ? '-' : '';

  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;

  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;

  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Go's `strconv.ParseInt(s, 0, 64)` syntax (decimal, 0x, 0o, 0b, legacy leading-zero octal). */
function goParseInt(text: string): bigint | null {
  const match = /^([+-]?)(0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|0[0-7]*|[1-9][0-9]*)$/.exec(text);

  if (!match) return null;

  const body = match[2];
  const value = /^0[0-7]+$/.test(body) ? BigInt(`0o${body.slice(1)}`) : BigInt(body.toLowerCase());

  return match[1] === '-' ? -value : value;
}

const GO_YAML_SPECIAL: Record<string, Buffer | null> = {
  '~': null,
  null: null,
  Null: null,
  NULL: null,
  '': null,
  true: Buffer.from('True'),
  True: Buffer.from('True'),
  TRUE: Buffer.from('True'),
  false: Buffer.from('False'),
  False: Buffer.from('False'),
  FALSE: Buffer.from('False'),
  '.nan': Buffer.from('NaN'),
  '.NaN': Buffer.from('NaN'),
  '.NAN': Buffer.from('NaN'),
  '.inf': Buffer.from('+Inf'),
  '.Inf': Buffer.from('+Inf'),
  '.INF': Buffer.from('+Inf'),
  '+.inf': Buffer.from('+Inf'),
  '+.Inf': Buffer.from('+Inf'),
  '+.INF': Buffer.from('+Inf'),
  '-.inf': Buffer.from('-Inf'),
  '-.Inf': Buffer.from('-Inf'),
  '-.INF': Buffer.from('-Inf'),
};

/**
 * MAC bytes of a value SOPS left unencrypted: SOPS reads YAML with go-yaml v3 and hashes `ToBytes(value)`, so plain
 * scalars are resolved the go-yaml way (underscores in numbers, `0777` octal, `0b` binary, booleans as
 * `True` / `False`, floats via `FormatFloat`). Null values aren't hashed.
 */
function plainMacBytes(node: Scalar): Buffer | null {
  if (node.type === 'PLAIN' && !node.tag) {
    const source = typeof node.source === 'string' ? node.source : String(node.value ?? '');

    if (Object.prototype.hasOwnProperty.call(GO_YAML_SPECIAL, source)) return GO_YAML_SPECIAL[source];

    if (/^[-+.0-9]/.test(source)) {
      const plain = source.replace(/_/g, '');
      const int = goParseInt(plain);

      if (int !== null) return Buffer.from(int.toString());

      if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(plain)) {
        return Buffer.from(goFormatFloat(Number(plain)));
      }
    }

    return Buffer.from(source, 'utf8');
  }

  const value = node.value;

  if (value === null || value === undefined) return null;

  if (typeof value === 'boolean') return Buffer.from(value ? 'True' : 'False');

  if (typeof value === 'bigint') return Buffer.from(value.toString());

  if (typeof value === 'number')
    return Buffer.from(Number.isInteger(value) ? BigInt(value).toString() : goFormatFloat(value));

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);

  return Buffer.from(String(value), 'utf8');
}

interface Decrypted {
  value: unknown;
  macBytes: Buffer;
  /** Integer-valued floats keep a fraction digit when written back. */
  float: boolean;
}

function decryptRaw(dataKey: Buffer, value: string, aad: string): { type: EncType; plaintext: Buffer } | null {
  const match = ENC_PATTERN.exec(value);

  if (!match) return null;

  const iv = Buffer.from(match[2], 'base64');
  const tag = Buffer.from(match[3], 'base64');

  if (iv.length === 0 || tag.length !== 16) return null;

  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, iv, { authTagLength: 16 });

    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);

    return {
      type: match[4] as EncType,
      plaintext: Buffer.concat([decipher.update(Buffer.from(match[1], 'base64')), decipher.final()]),
    };
  } catch {
    return null;
  }
}

function typedValue(type: EncType, plaintext: Buffer, where: string): Decrypted {
  const text = plaintext.toString('utf8');

  switch (type) {
    case 'str':
      return { value: text, macBytes: plaintext, float: false };
    case 'bytes':
    case 'time':
      // Timestamps are Go `MarshalText` (RFC 3339) output, kept as strings.
      return { value: text, macBytes: plaintext, float: false };
    case 'int': {
      const int = /^[+-]?[0-9]+$/.test(text) ? BigInt(text) : null;

      if (int === null) throw new SopsError(`malformed int at ${where}`);

      const value =
        int >= BigInt(Number.MIN_SAFE_INTEGER) && int <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(int) : int;

      return { value, macBytes: Buffer.from(int.toString()), float: false };
    }
    case 'float': {
      const special: Record<string, number> = { NaN: NaN, Inf: Infinity, '+Inf': Infinity, '-Inf': -Infinity };
      const value = special[text] ?? (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text) ? Number(text) : NaN);

      if (Number.isNaN(value) && text !== 'NaN') throw new SopsError(`malformed float at ${where}`);

      return { value, macBytes: Buffer.from(goFormatFloat(value)), float: true };
    }
    case 'bool': {
      const truthy = ['1', 't', 'T', 'TRUE', 'true', 'True'];
      const falsy = ['0', 'f', 'F', 'FALSE', 'false', 'False'];

      if (!truthy.includes(text) && !falsy.includes(text)) throw new SopsError(`malformed bool at ${where}`);

      const value = truthy.includes(text);

      return { value, macBytes: Buffer.from(value ? 'True' : 'False'), float: false };
    }
    default:
      throw new SopsError(`unexpected value type at ${where}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------------------------------------------

function encryptionRule(meta: SopsMetadata): (path: string[]) => boolean {
  const compile = (pattern: string) => {
    try {
      return new RegExp(pattern);
    } catch {
      throw new SopsError('invalid encryption regex in metadata');
    }
  };

  if (meta.unencryptedSuffix !== undefined) {
    const suffix = meta.unencryptedSuffix;

    return (path) => !path.some((key) => key.endsWith(suffix));
  }

  if (meta.encryptedSuffix !== undefined) {
    const suffix = meta.encryptedSuffix;

    return (path) => path.some((key) => key.endsWith(suffix));
  }

  if (meta.unencryptedRegex !== undefined) {
    const regex = compile(meta.unencryptedRegex);

    return (path) => !path.some((key) => regex.test(key));
  }

  if (meta.encryptedRegex !== undefined) {
    const regex = compile(meta.encryptedRegex);

    return (path) => path.some((key) => regex.test(key));
  }

  return () => true;
}

function aadOf(path: string[]): string {
  return `${path.join(':')}:`;
}

interface WalkState {
  dataKey: Buffer;
  encrypted: (path: string[]) => boolean;
  macOnlyEncrypted: boolean;
  hash: ReturnType<typeof createHash>;
  /** Every path seen (additional data candidates for encrypted comments). */
  paths: Map<string, string[]>;
}

/**
 * Walks values in document order, decrypting in place and feeding the MAC. Returns the comment text when the node
 * is a sequence item that SOPS stored as an encrypted comment (SOPS writes comments inside lists as `- ENC[…,type:comment]`
 * items; they become comments again here).
 */
function walk(node: Node | null | undefined, path: string[], state: WalkState, inSeq = false): string | undefined {
  if (node === null || node === undefined) return undefined;

  if (isAlias(node)) throw new SopsError(`YAML aliases are not supported (at ${aadOf(path)})`);

  state.paths.set(aadOf(path), path);

  if (isMap(node)) {
    for (const pair of node.items) {
      const key = pair.key;

      if (!isScalar(key) || typeof key.value !== 'string') {
        throw new SopsError(`only string keys are supported (at ${aadOf(path)})`);
      }

      walk(pair.value as Node | null, [...path, key.value], state);
    }

    return undefined;
  }

  if (isSeq(node)) {
    walkSeq(node, path, state);

    return undefined;
  }

  if (!isScalar(node)) throw new SopsError(`unsupported YAML node at ${aadOf(path)}`);

  const encrypted = state.encrypted(path);
  const where = aadOf(path);

  if (!encrypted) {
    const bytes = plainMacBytes(node);

    if (bytes && !state.macOnlyEncrypted) state.hash.update(bytes);

    return undefined;
  }

  if (node.value === null || node.value === undefined) return undefined;

  if (typeof node.value !== 'string') throw new SopsError(`value at ${where} is not encrypted`);

  // SOPS leaves empty strings as they are.
  if (node.value === '') return undefined;

  const raw = decryptRaw(state.dataKey, node.value, where);

  if (!raw) {
    throw new SopsError(
      ENC_PATTERN.test(node.value)
        ? `could not decrypt value at ${where} (tampered or wrong data key)`
        : `value at ${where} is not encrypted`,
    );
  }

  if (raw.type === 'comment') {
    if (!inSeq) throw new SopsError(`unexpected comment value at ${where}`);

    // Comments aren't part of the MAC.
    return raw.plaintext.toString('utf8');
  }

  const decrypted = typedValue(raw.type, raw.plaintext, where);

  state.hash.update(decrypted.macBytes);
  raw.plaintext.fill(0);
  node.value = decrypted.value;
  node.type = undefined;
  node.tag = undefined;
  node.format = undefined;
  node.minFractionDigits =
    decrypted.float && typeof decrypted.value === 'number' && Number.isInteger(decrypted.value) ? 1 : undefined;

  return undefined;
}

function joinComments(...comments: (string | null | undefined)[]): string | undefined {
  const lines = comments.filter((comment): comment is string => typeof comment === 'string' && comment !== '');

  return lines.length > 0 ? lines.join('\n') : undefined;
}

function walkSeq(node: YAMLSeq, path: string[], state: WalkState): void {
  const items: unknown[] = [];
  let pending: string | undefined;

  for (const item of node.items) {
    const comment = walk(item as Node | null, path, state, true);

    if (comment !== undefined) {
      const holder = item as Scalar;

      pending = joinComments(pending, holder.commentBefore, comment, holder.comment);
      continue;
    }

    if (pending !== undefined && item && typeof item === 'object') {
      const holder = item as Scalar;

      holder.commentBefore = joinComments(pending, holder.commentBefore);
      pending = undefined;
    }

    items.push(item);
  }

  node.items = items;

  if (pending !== undefined) node.comment = joinComments(node.comment, pending);
}

/** Decrypts `#ENC[…,type:comment]` lines. Comments carry their branch's path, so all walked paths are tried. */
function decryptComment(comment: string | null | undefined, state: WalkState): string | null | undefined {
  if (!comment || !comment.includes('ENC[')) return comment;

  return comment
    .split('\n')
    .map((line) => {
      const match = ENC_COMMENT_LINE.exec(line);

      if (!match) return line;

      for (const aad of state.paths.keys()) {
        const raw = decryptRaw(state.dataKey, match[1], aad);

        if (raw) {
          if (raw.type !== 'comment') break;

          return raw.plaintext.toString('utf8');
        }
      }

      throw new SopsError('could not decrypt an encrypted comment (tampered or wrong data key)');
    })
    .join('\n');
}

function decryptComments(doc: Document, state: WalkState): void {
  doc.commentBefore = decryptComment(doc.commentBefore, state) ?? null;
  doc.comment = decryptComment(doc.comment, state) ?? null;

  const visitNode = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;

    const holder = node as { commentBefore?: string | null; comment?: string | null };

    if (isScalar(node) || isMap(node) || isSeq(node) || isAlias(node)) {
      holder.commentBefore = decryptComment(holder.commentBefore, state);
      holder.comment = decryptComment(holder.comment, state);
    }

    if (isMap(node)) {
      for (const pair of node.items) {
        visitNode(pair.key);
        visitNode(pair.value);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) visitNode(item);
    }
  };

  visitNode(doc.contents);
}

// ---------------------------------------------------------------------------------------------------------------
// Data key and MAC
// ---------------------------------------------------------------------------------------------------------------

function decryptDataKey(meta: SopsMetadata, identities: string[]): Buffer {
  if (identities.length === 0) throw new SopsError('no age identities given');

  const own = new Set(identities.map(ageRecipientOf));
  // Entries addressed to one of our recipients first; the recipient field isn't authenticated, so try the rest too.
  const entries = [...meta.age].sort((a, b) => Number(own.has(b.recipient)) - Number(own.has(a.recipient)));

  for (const entry of entries) {
    let key: Buffer;

    try {
      key = ageDecrypt(entry.enc, identities);
    } catch {
      continue;
    }

    if (key.length !== DATA_KEY_BYTES) {
      key.fill(0);
      throw new SopsError('invalid data key');
    }

    return key;
  }

  throw new SopsError(
    `no age identity matches the file recipients (${meta.age.map((entry) => entry.recipient || '?').join(', ')})`,
  );
}

function verifyMac(meta: SopsMetadata, dataKey: Buffer, computed: string): void {
  const raw = decryptRaw(dataKey, meta.mac, sopsMacAad(meta.lastModified));

  if (!raw || raw.type !== 'str')
    throw new SopsError('could not decrypt the MAC (tampered metadata or wrong data key)');

  const expected = Buffer.from(raw.plaintext.toString('utf8').toUpperCase());
  const actual = Buffer.from(computed);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new SopsError('MAC mismatch: the file was modified after encryption');
  }
}

function metadataValue(doc: Document): unknown {
  const value = (doc.contents as YAMLMap).items[sopsPairIndex(doc)].value;

  return isNode(value) ? value.toJS(doc, { maxAliasCount: 0 }) : value;
}

// ---------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------

/** Reads the `sops` metadata block of an encrypted YAML file (no decryption). */
export function readSopsMetadata(text: string): SopsMetadata {
  const doc = parseDocuments(text).find((d) => sopsPairIndex(d) >= 0);

  if (!doc) throw new SopsError('not a SOPS file (no sops metadata)');

  return readMetadata(metadataValue(doc));
}

/** Decrypts a SOPS-encrypted YAML file (single or multi-document) with age identities (`AGE-SECRET-KEY-1…`). */
export function sopsDecrypt(text: string, ageIdentities: string[]): SopsDecryptResult {
  const documents = parseDocuments(text);
  const withMeta = documents.find((doc) => sopsPairIndex(doc) >= 0);

  if (!withMeta) throw new SopsError('not a SOPS file (no sops metadata)');

  const meta = readMetadata(metadataValue(withMeta));

  for (const doc of documents) {
    if (!isMap(doc.contents)) throw new SopsError('every document must be a mapping');

    const index = sopsPairIndex(doc);

    if (index >= 0) doc.contents.items.splice(index, 1);
  }

  const dataKey = decryptDataKey(meta, ageIdentities);

  try {
    const state: WalkState = {
      dataKey,
      encrypted: encryptionRule(meta),
      macOnlyEncrypted: meta.macOnlyEncrypted,
      hash: meta.macOnlyEncrypted ? createHash('sha512').update(MAC_ONLY_ENCRYPTED_INIT) : createHash('sha512'),
      paths: new Map([['', []]]),
    };

    for (const doc of documents) walk(doc.contents as Node, [], state);

    verifyMac(meta, dataKey, state.hash.digest('hex').toUpperCase());

    for (const doc of documents) decryptComments(doc, state);

    const yaml = documents
      .map((doc, i) => {
        const out = doc.toString({ lineWidth: 0 });

        return i === 0 || out.startsWith('---') ? out : `---\n${out}`;
      })
      .join('');

    return { yaml, documents: documents.map((doc) => doc.toJS({ maxAliasCount: 0 })) };
  } finally {
    dataKey.fill(0);
  }
}

/** Decrypted YAML text (the `sops` block removed). */
export function sopsDecryptYaml(text: string, ageIdentities: string[]): string {
  return sopsDecrypt(text, ageIdentities).yaml;
}

/** Decrypted documents as plain JS values (one entry per YAML document). */
export function sopsDecryptYamlDocuments(text: string, ageIdentities: string[]): unknown[] {
  return sopsDecrypt(text, ageIdentities).documents;
}
