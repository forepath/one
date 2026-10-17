import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

import { PLATFORM_PREFIXES } from './s3-gateway.rules';

/**
 * External copies of the platform bucket (3.20): every object is encrypted on the control plane before it leaves
 * ("external targets never see plaintext") with a key derived from the backup key generation, so the recovery kit
 * (or the KMS escrow) alone decrypts them on a fresh node. Object names stay readable (backup names and times, no
 * data) so a disaster recovery can find the newest set without a catalog.
 *
 * Format `LWPC` v1 (streaming, verifiable without buffering whole objects):
 *   header  = "LWPC" | 0x01 | generation (uint32 BE) | nonce prefix (8 random bytes)            = 17 bytes
 *   chunk i = AES-256-GCM(plaintext[i * 1 MiB … +1 MiB]) | tag (16)
 *             IV  = nonce prefix | i (uint32 BE)
 *             AAD = "lwpc1" 0 <object key> 0 <i> 0 <1 if last chunk else 0>
 * An empty object has one empty (last) chunk. The AAD binds every chunk to its object and position and marks the
 * last one, so swapped, reordered, truncated or extended copies fail to decrypt.
 */

export const COPY_MAGIC = Buffer.from('LWPC', 'ascii');
export const COPY_VERSION = 1;
export const COPY_HEADER_BYTES = 17;
export const COPY_CHUNK_BYTES = 1024 * 1024;
const TAG_BYTES = 16;

/** Root of the copies on a target: `<prefix>platform/…` (S3) or `<path>/platform/…` (SFTP). */
export const COPY_ROOT = 'platform/';
/** Small, unencrypted descriptions next to the copies (no secrets): cluster id and key generations (kit / escrow). */
export const DR_CLUSTER_KEY = `${COPY_ROOT}dr/cluster.json`;
export const DR_KEYS_KEY = `${COPY_ROOT}dr/keys.json`;

/** Key of the external copies of one generation (below its data key). */
export function platformCopyKey(dataKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', dataKey, Buffer.alloc(0), Buffer.from('loadweaver/backup/platform-copy'), 32));
}

/** Where a platform-bucket object lands on a target (relative to the target's prefix / path). */
export function copyKeyOf(sourceKey: string): string {
  return `${COPY_ROOT}${sourceKey}`;
}

export function chunkCount(plainSize: number): number {
  return Math.max(1, Math.ceil(plainSize / COPY_CHUNK_BYTES));
}

/** Size of the encrypted copy of `plainSize` bytes (checked after every upload). */
export function encryptedSize(plainSize: number): number {
  return COPY_HEADER_BYTES + plainSize + TAG_BYTES * chunkCount(plainSize);
}

function aad(objectKey: string, index: number, last: boolean): Buffer {
  return Buffer.from(`lwpc1\0${objectKey}\0${index}\0${last ? 1 : 0}`, 'utf8');
}

function iv(prefix: Buffer, index: number): Buffer {
  const out = Buffer.alloc(12);

  prefix.copy(out, 0, 0, 8);
  out.writeUInt32BE(index, 8);

  return out;
}

/**
 * Encrypts a stream of exactly `plainSize` bytes (the source object's length; a different length fails, so a source
 * that changed while it was read is never copied as complete).
 */
export function encryptStream(key: Buffer, generation: number, objectKey: string, plainSize: number): Transform {
  const prefix = randomBytes(8);
  const chunks = chunkCount(plainSize);
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let index = 0;
  let seen = 0;

  const header = Buffer.alloc(COPY_HEADER_BYTES);

  COPY_MAGIC.copy(header, 0);
  header.writeUInt8(COPY_VERSION, 4);
  header.writeUInt32BE(generation, 5);
  prefix.copy(header, 9);

  const sealChunk = (plain: Buffer): Buffer => {
    const last = index === chunks - 1;
    const cipher = createCipheriv('aes-256-gcm', key, iv(prefix, index));

    cipher.setAAD(aad(objectKey, index, last));

    const out = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

    index++;

    return out;
  };

  let started = false;
  const start = (stream: Transform) => {
    if (!started) stream.push(header);

    started = true;
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      start(this);
      seen += chunk.length;

      if (seen > plainSize) return callback(new Error(`${objectKey} is longer than its listed ${plainSize} bytes`));

      pending.push(chunk);
      pendingBytes += chunk.length;

      // Full chunks go out as they fill up; the last one waits for the end.
      while (pendingBytes >= COPY_CHUNK_BYTES && index < chunks - 1) {
        const all = Buffer.concat(pending);

        this.push(sealChunk(all.subarray(0, COPY_CHUNK_BYTES)));
        pending = [all.subarray(COPY_CHUNK_BYTES)];
        pendingBytes = all.length - COPY_CHUNK_BYTES;
      }

      callback();
    },
    flush(callback: TransformCallback) {
      if (seen !== plainSize) return callback(new Error(`${objectKey} ended after ${seen} of ${plainSize} bytes`));

      start(this);
      this.push(sealChunk(Buffer.concat(pending)));
      pending = [];
      callback();
    },
  });
}

/** Header of an encrypted copy: which backup-key generation it needs. */
export function readCopyHeader(header: Buffer): { generation: number; prefix: Buffer } {
  if (header.length < COPY_HEADER_BYTES || !header.subarray(0, 4).equals(COPY_MAGIC))
    throw new Error('not an encrypted Loadweaver platform copy');

  if (header.readUInt8(4) !== COPY_VERSION) throw new Error(`unsupported copy format ${header.readUInt8(4)}`);

  return { generation: header.readUInt32BE(5), prefix: Buffer.from(header.subarray(9, COPY_HEADER_BYTES)) };
}

/**
 * Decrypts an encrypted copy; `keyFor` returns the copy key of a generation (from the running cluster's backup key
 * service, or derived from the kit's root on a fresh node). Fails on any tampering, truncation or extension.
 */
export function decryptStream(objectKey: string, keyFor: (generation: number) => Buffer): Transform {
  let header: Buffer | null = null;
  let key: Buffer | null = null;
  let buffered = Buffer.alloc(0);
  let index = 0;
  const full = COPY_CHUNK_BYTES + TAG_BYTES;

  const openChunk = (sealed: Buffer, last: boolean): Buffer => {
    if (sealed.length < TAG_BYTES) throw new Error(`${objectKey}: truncated copy`);

    const { prefix } = readCopyHeader(header as Buffer);
    const decipher = createDecipheriv('aes-256-gcm', key as Buffer, iv(prefix, index));

    decipher.setAAD(aad(objectKey, index, last));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));

    try {
      const out = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);

      index++;

      return out;
    } catch {
      throw new Error(`${objectKey}: the copy does not decrypt (wrong key, tampered or truncated)`);
    }
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      try {
        buffered = Buffer.concat([buffered, chunk]);

        if (!header) {
          if (buffered.length < COPY_HEADER_BYTES) return callback();

          header = Buffer.from(buffered.subarray(0, COPY_HEADER_BYTES));
          key = keyFor(readCopyHeader(header).generation);
          buffered = buffered.subarray(COPY_HEADER_BYTES);
        }

        // A full chunk followed by more data is not the last one.
        while (buffered.length > full) {
          this.push(openChunk(buffered.subarray(0, full), false));
          buffered = buffered.subarray(full);
        }

        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (!header) throw new Error(`${objectKey}: not an encrypted Loadweaver platform copy`);

        this.push(openChunk(buffered, true));
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

/** SHA-256 of whatever passes through (the stored bytes, recorded as object metadata for verification). */
export function hashingStream(): Transform & { digest: () => string } {
  const hash = createHash('sha256');
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  }) as Transform & { digest: () => string };
  let digest: string | null = null;

  stream.digest = () => (digest ??= hash.digest('hex'));

  return stream;
}

// ------------------------------------------------------------------------------------------ copy planning

export interface SourceObject {
  key: string;
  etag: string;
  size: number;
}

export interface CopiedObject {
  key: string;
  etag: string;
  size: number;
}

/** Objects that need a (new) copy: missing on the target, or rewritten in the bucket since (other ETag / size). */
export function objectsToCopy(source: readonly SourceObject[], copied: readonly CopiedObject[]): SourceObject[] {
  const known = new Map(copied.map((c) => [c.key, c]));

  return source.filter((o) => {
    const c = known.get(o.key);

    return !c || c.etag !== o.etag || c.size !== o.size;
  });
}

/** What a copy looks like on the target after a good upload; null = fine, otherwise why not. */
export function copyVerificationError(
  expected: { storedSize: number; sha256: string },
  actual: { size: number; sha256?: string | null } | null,
): string | null {
  if (!actual) return 'missing on the target after the upload';

  if (actual.size !== expected.storedSize)
    return `size on the target is ${actual.size} bytes, ${expected.storedSize} expected`;

  if (actual.sha256 && actual.sha256 !== expected.sha256) return 'checksum on the target differs from the upload';

  return null;
}

// ------------------------------------------------------------------------------------- disaster recovery

/** The parts of the platform bucket a disaster recovery reads (relative to the copy root). */
export const DR_PREFIXES = {
  envelopes: `${COPY_ROOT}${PLATFORM_PREFIXES.drEnvelope}`,
  spilo: `${COPY_ROOT}${PLATFORM_PREFIXES.postgres}`,
  etcd: `${COPY_ROOT}${PLATFORM_PREFIXES.etcd}`,
} as const;

const WAL_NAME = /^([0-9A-F]{8})([0-9A-F]{16})(\.partial)?(\.(br|lz4|lzma|zst|gz))?$/;
const HISTORY_NAME = /^[0-9A-F]{8}\.history(\.(br|lz4|lzma|zst|gz))?$/;

/**
 * WAL objects a restore of `backup` needs: every segment from the backup's start segment on (any timeline; WAL-G
 * picks the timeline by the history files) plus all timeline history files. `keys` are the objects under
 * `…/wal/17/wal_005/`.
 */
export function walForBackup(backup: string, walPrefix: string, keys: readonly string[]): string[] {
  const start = /^base_[0-9A-F]{8}([0-9A-F]{16})/.exec(backup)?.[1];

  if (!start) throw new Error(`not a WAL-G base backup name: ${backup}`);

  return keys.filter((k) => {
    if (!k.startsWith(walPrefix)) return false;

    const name = k.slice(walPrefix.length);

    if (name.includes('/')) return false;

    if (HISTORY_NAME.test(name)) return true;

    const wal = WAL_NAME.exec(name);

    return !!wal && wal[2] >= start;
  });
}

export interface DrCandidate {
  /** Base backup name (`base_…`). */
  backup: string;
  /** Patroni scope its WAL lives under. */
  scope: string;
  /** When the backup finished (from its sentinel), if known. */
  finishedAt: Date | null;
}

/**
 * The base backup a disaster recovery starts from: the newest whose envelope and stop sentinel are both on the
 * target; with a target time, the newest that finished before it (WAL replay covers the rest).
 */
export function chooseDrBackup(
  candidates: readonly DrCandidate[],
  envelopes: ReadonlySet<string>,
  targetTime?: Date,
): DrCandidate | null {
  const usable = candidates
    .filter((c) => envelopes.has(c.backup))
    .filter((c) => !targetTime || (c.finishedAt !== null && c.finishedAt.getTime() <= targetTime.getTime()))
    .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0) || (a.backup < b.backup ? 1 : -1));

  return usable[0] ?? null;
}

/** Newest etcd snapshot among `etcd/<cluster>/etcd-<stamp>.db` keys (names sort by time). */
export function newestEtcdSnapshot(keys: readonly string[]): string | null {
  return (
    keys
      .filter((k) => /\/etcd-\d{8}t\d{6}z\.db$/.test(k))
      .sort()
      .at(-1) ?? null
  );
}
