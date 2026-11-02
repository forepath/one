import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { Writable } from 'node:stream';

/**
 * Wire format of the node-to-node checkpoint transfer (3.10): length-prefixed JSON frames (`u32` big endian + UTF-8
 * JSON) with raw file bytes in between. One connection carries one batch (a pre-dump round, or the final dump with
 * the writable layer):
 *
 *   source → target: hello { token, migration, attempt, batch }
 *                    entry { type: 'dir' | 'file' | 'symlink', path, … } [file: `size` raw bytes, then sum { sha256 }]
 *                    end { files, bytes }
 *   target → source: result { ok, bytes?, error? }
 *
 * File contents are streamed with backpressure on both ends (bounded memory); every file is verified by its SHA-256
 * before it is renamed into place.
 *
 * Relay connections (QEMU live migration, 3.35 / M7.4): `hello { relay: true, batch: 'relay', … }`, answered with
 * `result { ok }`; after that the connection carries raw bytes in both directions between the source launcher's
 * libvirt (through a local unix socket on the source) and the target launcher's libvirt session socket.
 */

export const TRANSFER_PROTOCOL_VERSION = 1;
/** Frames carry metadata only; anything bigger is a broken or hostile peer. */
export const MAX_FRAME_BYTES = 64 * 1024;
/** Limits of one batch (CRIU image dirs are flat; the writable layer travels as one tar). */
export const MAX_BATCH_ENTRIES = 100_000;
export const MAX_FILE_BYTES = 256 * 1024 ** 3;

export interface TransferHello {
  type: 'hello';
  v: number;
  token: string;
  migration: string;
  attempt: number;
  /** Batch name (e.g. `p1`, `final`), for logs and the receiver's bookkeeping. */
  batch: string;
  /** A relay connection (raw bytes after the handshake) instead of a batch. */
  relay?: boolean;
}

export type TransferEntry =
  | { type: 'dir'; path: string; mode: number }
  | { type: 'file'; path: string; size: number; mode: number }
  | { type: 'symlink'; path: string; target: string };

export interface TransferSum {
  type: 'sum';
  sha256: string;
}

export interface TransferEnd {
  type: 'end';
  files: number;
  bytes: number;
}

export interface TransferResult {
  type: 'result';
  ok: boolean;
  bytes?: number;
  error?: string;
}

const SAFE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
/** CRIU links each image dir to its parent (`parent -> ../p2`); nothing else may be a symlink. */
const SAFE_LINK_TARGET = /^\.\.\/[A-Za-z0-9._-]+$/;

/** A relative path inside the session directory: no `..`, no absolute paths, a conservative charset. */
export function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 512 &&
    SAFE_PATH.test(path) &&
    path.split('/').every((segment) => segment !== '.' && segment !== '..') &&
    posix.normalize(path) === path
  );
}

export function safeLinkTarget(target: string): boolean {
  return SAFE_LINK_TARGET.test(target) && target !== '../.' && target !== '../..';
}

/**
 * A symlink entry the receiver accepts (M6 review M2): only CRIU's `parent` link directly inside an image dir
 * (`<dir>/parent -> ../<sibling dir>`). Links anywhere else (e.g. a top-level `l -> ../<other migration>`) are
 * refused, and the receiver never writes through a link it received.
 */
export function safeLinkEntry(path: string, target: string): boolean {
  const segments = path.split('/');

  return safeRelativePath(path) && segments.length === 2 && segments[1] === 'parent' && safeLinkTarget(target);
}

export function encodeFrame(value: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(value), 'utf8');

  if (json.length > MAX_FRAME_BYTES) throw new Error('transfer frame too large');

  const header = Buffer.alloc(4);

  header.writeUInt32BE(json.length, 0);

  return Buffer.concat([header, json]);
}

/** Writes and waits for `drain` when the socket's buffer is full (backpressure); fails once the peer is gone. */
export async function writeChunk(target: Writable, chunk: Buffer): Promise<void> {
  if (target.destroyed || target.writableEnded) throw new Error('transfer connection closed');

  if (target.write(chunk)) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      target.off('drain', onDrain);
      target.off('close', onClose);
      target.off('error', onError);
    };
    const onDrain = () => (cleanup(), resolve());
    const onClose = () => (cleanup(), reject(new Error('transfer connection closed')));
    const onError = (error: Error) => (cleanup(), reject(error));

    target.on('drain', onDrain);
    target.on('close', onClose);
    target.on('error', onError);
  });
}

/** Reads frames and byte runs from a stream (its async iterator pulls, so the peer is throttled by TCP). */
export class FrameReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private pending: Buffer = Buffer.alloc(0);

  constructor(source: AsyncIterable<Buffer | string>) {
    const inner = source[Symbol.asyncIterator]();

    this.iterator = {
      next: async () => {
        const result = await inner.next();

        return result.done ? result : { done: false, value: Buffer.from(result.value) };
      },
    };
  }

  private async fill(min: number): Promise<void> {
    while (this.pending.length < min) {
      const next = await this.iterator.next();

      if (next.done) throw new Error('transfer stream ended unexpectedly');

      this.pending = this.pending.length ? Buffer.concat([this.pending, next.value]) : next.value;
    }
  }

  async frame<T>(): Promise<T> {
    await this.fill(4);

    const length = this.pending.readUInt32BE(0);

    if (length > MAX_FRAME_BYTES) throw new Error('transfer frame too large');

    await this.fill(4 + length);

    const json = this.pending.subarray(4, 4 + length).toString('utf8');

    this.pending = this.pending.subarray(4 + length);

    return JSON.parse(json) as T;
  }

  /** Everything after the frames read so far (buffered bytes first), as it arrives (relay connections). */
  async *remaining(): AsyncGenerator<Buffer> {
    if (this.pending.length > 0) {
      const buffered = this.pending;

      this.pending = Buffer.alloc(0);
      yield buffered;
    }

    for (;;) {
      const next = await this.iterator.next();

      if (next.done) return;

      yield next.value;
    }
  }

  /** Yields exactly `count` bytes in chunks as they arrive. */
  async *bytes(count: number): AsyncGenerator<Buffer> {
    let left = count;

    while (left > 0) {
      if (this.pending.length === 0) await this.fill(1);

      const take = Math.min(left, this.pending.length);

      yield this.pending.subarray(0, take);
      this.pending = this.pending.subarray(take);
      left -= take;
    }
  }
}

/** Every entry below `root` (relative paths, parents before children), for one batch. */
export async function listEntries(root: string, prefix: string): Promise<TransferEntry[]> {
  const entries: TransferEntry[] = [];
  const walk = async (relative: string): Promise<void> => {
    const absolute = join(root, relative);
    const info = await lstat(absolute);

    if (info.isSymbolicLink()) {
      entries.push({ type: 'symlink', path: relative, target: await readlink(absolute) });
    } else if (info.isDirectory()) {
      entries.push({ type: 'dir', path: relative, mode: info.mode & 0o777 });

      for (const name of (await readdir(absolute)).sort()) await walk(`${relative}/${name}`);
    } else if (info.isFile()) {
      entries.push({ type: 'file', path: relative, size: info.size, mode: info.mode & 0o777 });
    }
  };

  await walk(prefix);

  return entries;
}

/** Streams one batch over `socket` (already past the TLS handshake); resolves with the bytes sent. */
export async function sendBatch(
  socket: Writable,
  hello: Omit<TransferHello, 'type' | 'v'>,
  root: string,
  entries: TransferEntry[],
): Promise<number> {
  let bytes = 0;
  let files = 0;

  await writeChunk(socket, encodeFrame({ type: 'hello', v: TRANSFER_PROTOCOL_VERSION, ...hello }));

  for (const entry of entries) {
    await writeChunk(socket, encodeFrame(entry));

    if (entry.type !== 'file') continue;

    const hash = createHash('sha256');
    let sent = 0;

    for await (const chunk of createReadStream(join(root, entry.path), { highWaterMark: 256 * 1024 })) {
      const buffer = chunk as Buffer;

      // A file that grew after listing would desynchronise the stream: send exactly the announced size.
      const part = buffer.subarray(0, Math.max(0, entry.size - sent));

      if (part.length === 0) break;

      hash.update(part);
      sent += part.length;
      await writeChunk(socket, part);
    }

    if (sent !== entry.size) throw new Error(`${entry.path} changed while it was sent`);

    await writeChunk(socket, encodeFrame({ type: 'sum', sha256: hash.digest('hex') } satisfies TransferSum));
    bytes += entry.size;
    files++;
  }

  await writeChunk(socket, encodeFrame({ type: 'end', files, bytes } satisfies TransferEnd));

  return bytes;
}
