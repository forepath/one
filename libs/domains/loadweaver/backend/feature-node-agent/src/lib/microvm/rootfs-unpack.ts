import { createHash, type Hash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, lutimes, mkdir, open, rm, symlink, utimes, lchown, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, pipeline, type Readable, Transform, type TransformCallback } from 'node:stream';
import * as zlib from 'node:zlib';

import { CommandRunner } from '../host/command-runner';

/**
 * Unpacks one OCI / Docker image layer into a directory overlayfs can use as a lower layer (3.35, M7.2 "Image unpack
 * cache"). Everything a layer tar could do to the host is decided here:
 *
 * - entry paths are normalised; absolute paths, `..` components and paths through a symlink are refused (the layer
 *   fails). Parents are walked with `lstat` (no symlink is ever followed); this is race-free because the unpacking
 *   process is the only writer of its staging directory, inside a mount namespace where everything else is read-only;
 * - hardlinks may only point to entries already extracted from the same layer;
 * - char / block devices and FIFOs are dropped (counted): the guest gets its own `/dev`;
 * - whiteouts become overlay whiteouts (`.wh.<name>` → char device 0/0, `.wh..wh..opq` → `trusted.overlay.opaque=y`);
 * - ownership and modes (setuid / setgid included) are the guest's semantics and kept: the overlay is mounted
 *   `nosuid,nodev,noexec` on the host, nothing on the host executes from it, and the cache root is 0700 root;
 * - xattrs: only `security.capability` and `user.*` are kept;
 * - the decompressed size is bounded (decompression bombs) and both digests (compressed, diffID) are computed.
 */

export const LAYER_MEDIA_TYPES = {
  tar: ['application/vnd.oci.image.layer.v1.tar', 'application/vnd.docker.image.rootfs.diff.tar'],
  gzip: ['application/vnd.oci.image.layer.v1.tar+gzip', 'application/vnd.docker.image.rootfs.diff.tar.gzip'],
  zstd: ['application/vnd.oci.image.layer.v1.tar+zstd', 'application/vnd.docker.image.rootfs.diff.tar.zstd'],
} as const;

export type LayerCompression = keyof typeof LAYER_MEDIA_TYPES;

export class LayerUnpackError extends Error {}

/** The compression of a layer media type; foreign / non-distributable and unknown layers are refused. */
export function layerCompression(mediaType: string): LayerCompression {
  if (/nondistributable|foreign/.test(mediaType))
    throw new LayerUnpackError(`layer media type ${mediaType} is foreign / non-distributable and is not unpacked`);

  for (const [compression, types] of Object.entries(LAYER_MEDIA_TYPES) as [LayerCompression, readonly string[]][])
    if (types.includes(mediaType)) return compression;

  throw new LayerUnpackError(`unsupported layer media type ${mediaType}`);
}

// --- tar reading -----------------------------------------------------------------------------------------------

export type TarEntryType = 'file' | 'dir' | 'symlink' | 'hardlink' | 'char' | 'block' | 'fifo';

export interface TarEntry {
  /** As stored (pax / GNU long names applied), not yet normalised. */
  name: string;
  type: TarEntryType;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  /** Seconds since the epoch. */
  mtime: number;
  linkname: string;
  xattrs: Record<string, Buffer>;
}

const BLOCK = 512;
/** Extended headers larger than this are refused (they only carry names and a few attributes). */
const MAX_META_BYTES = 1024 * 1024;

/** Pull-based reader over a byte stream: exact reads, and bodies streamed without buffering them whole. */
class ByteReader {
  private buffer: Buffer = Buffer.alloc(0);
  private done = false;

  constructor(private readonly source: AsyncIterator<Buffer>) {}

  private async fill(min: number): Promise<boolean> {
    while (this.buffer.length < min && !this.done) {
      const next = await this.source.next();

      if (next.done) this.done = true;
      else this.buffer = this.buffer.length ? Buffer.concat([this.buffer, next.value]) : next.value;
    }

    return this.buffer.length >= min;
  }

  /** Exactly `n` bytes, or null at a clean end (nothing left); a truncated read throws. */
  async read(n: number): Promise<Buffer | null> {
    if (!(await this.fill(n))) {
      if (this.buffer.length === 0) return null;

      throw new LayerUnpackError('unexpected end of the layer tar');
    }

    const out = this.buffer.subarray(0, n);

    this.buffer = this.buffer.subarray(n);

    return out;
  }

  /** Streams `n` bytes. */
  async *chunks(n: number): AsyncGenerator<Buffer> {
    let left = n;

    while (left > 0) {
      if (this.buffer.length === 0 && !(await this.fill(1)))
        throw new LayerUnpackError('unexpected end of the layer tar');

      const take = Math.min(left, this.buffer.length);

      yield this.buffer.subarray(0, take);
      this.buffer = this.buffer.subarray(take);
      left -= take;
    }
  }

  async skip(n: number): Promise<void> {
    for await (const chunk of this.chunks(n)) void chunk;
  }

  async drain(): Promise<void> {
    this.buffer = Buffer.alloc(0);

    while (!this.done) {
      const next = await this.source.next();

      if (next.done) this.done = true;
    }
  }
}

function cString(block: Buffer, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);

  return field.subarray(0, end === -1 ? length : end).toString('utf8');
}

/** Octal ASCII, or GNU base-256 (high bit of the first byte) for large values. */
export function tarNumber(block: Buffer, start: number, length: number): number {
  const field = block.subarray(start, start + length);

  if (field[0] & 0x80) {
    if (field[0] & 0x40) throw new LayerUnpackError('negative numeric field in the layer tar');

    let value = field[0] & 0x3f;

    for (let i = 1; i < field.length; i++) value = value * 256 + field[i];

    if (!Number.isSafeInteger(value)) throw new LayerUnpackError('numeric field out of range in the layer tar');

    return value;
  }

  const text = cString(block, start, length).trim();

  if (!text) return 0;

  if (!/^[0-7]+$/.test(text)) throw new LayerUnpackError('invalid numeric field in the layer tar');

  return parseInt(text, 8);
}

function checksumOk(block: Buffer): boolean {
  const stored = tarNumber(block, 148, 8);
  let sum = 0;

  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];

  return sum === stored;
}

/** Records of a pax extended header (`<len> <key>=<value>\n`). */
export function parsePax(data: Buffer): Map<string, Buffer> {
  const records = new Map<string, Buffer>();
  let offset = 0;

  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);

    if (space === -1) break;

    const length = Number(data.subarray(offset, space).toString('ascii'));

    if (!Number.isInteger(length) || length <= 0 || offset + length > data.length)
      throw new LayerUnpackError('invalid pax header in the layer tar');

    const record = data.subarray(space + 1, offset + length - 1);
    const equals = record.indexOf(0x3d);

    if (equals === -1) throw new LayerUnpackError('invalid pax record in the layer tar');

    records.set(record.subarray(0, equals).toString('utf8'), Buffer.from(record.subarray(equals + 1)));
    offset += length;
  }

  return records;
}

const TYPES: Record<string, TarEntryType> = {
  '0': 'file',
  '\0': 'file',
  '7': 'file',
  '1': 'hardlink',
  '2': 'symlink',
  '3': 'char',
  '4': 'block',
  '5': 'dir',
  '6': 'fifo',
};

/**
 * Reads tar entries (ustar, pax, GNU long names). Each entry's body must be consumed (or skipped) through `body`
 * before the next one is read. Sparse files, multi-volume archives and other exotic types fail the layer.
 */
export async function* readTar(
  source: AsyncIterable<Buffer>,
): AsyncGenerator<{ entry: TarEntry; body: () => AsyncGenerator<Buffer> }> {
  const reader = new ByteReader(source[Symbol.asyncIterator]());
  let pax = new Map<string, Buffer>();
  let longName: string | null = null;
  let longLink: string | null = null;

  for (;;) {
    const block = await reader.read(BLOCK);

    if (!block) break;

    if (block.every((b) => b === 0)) {
      // End of archive (two zero blocks); whatever follows is padding.
      await reader.drain();
      break;
    }

    if (!checksumOk(block)) throw new LayerUnpackError('tar header checksum mismatch');

    const flag = String.fromCharCode(block[156]);
    const size = tarNumber(block, 124, 12);
    const padded = Math.ceil(size / BLOCK) * BLOCK;

    if (flag === 'x' || flag === 'g' || flag === 'L' || flag === 'K') {
      if (size > MAX_META_BYTES) throw new LayerUnpackError('extended tar header too large');

      const data = size ? await reader.read(size) : Buffer.alloc(0);

      if (size && !data) throw new LayerUnpackError('unexpected end of the layer tar');

      await reader.skip(padded - size);

      if (flag === 'x') pax = parsePax(data as Buffer);
      else if (flag === 'L') longName = cString(data as Buffer, 0, size);
      else if (flag === 'K') longLink = cString(data as Buffer, 0, size);
      // 'g' (global pax header) carries no per-file data image layers rely on: ignored.
      continue;
    }

    const type = TYPES[flag];

    if (!type) throw new LayerUnpackError(`unsupported tar entry type '${flag}'`);

    const ustar = cString(block, 257, 6) === 'ustar';
    const prefix = ustar ? cString(block, 345, 155) : '';
    const baseName = cString(block, 0, 100);
    const text = (key: string) => pax.get(key)?.toString('utf8');
    const num = (key: string, fallback: number) => {
      const value = text(key);

      if (value === undefined) return fallback;

      const parsed = Number(value);

      if (!Number.isFinite(parsed) || parsed < 0) throw new LayerUnpackError(`invalid pax ${key}`);

      return Math.floor(parsed);
    };
    const xattrs: Record<string, Buffer> = {};

    for (const [key, value] of pax) {
      if (key.startsWith('SCHILY.xattr.')) xattrs[key.slice('SCHILY.xattr.'.length)] = value;
      else if (key.startsWith('LIBARCHIVE.xattr.'))
        xattrs[decodeURIComponent(key.slice('LIBARCHIVE.xattr.'.length))] = Buffer.from(value.toString(), 'base64');
    }

    const entrySize = type === 'file' ? num('size', size) : 0;
    const entry: TarEntry = {
      name: text('path') ?? longName ?? (prefix ? `${prefix}/${baseName}` : baseName),
      type,
      mode: tarNumber(block, 100, 8) & 0o7777,
      uid: num('uid', tarNumber(block, 108, 8)),
      gid: num('gid', tarNumber(block, 116, 8)),
      size: entrySize,
      mtime: num('mtime', tarNumber(block, 136, 12)),
      linkname: text('linkpath') ?? longLink ?? cString(block, 157, 100),
      xattrs,
    };

    pax = new Map();
    longName = null;
    longLink = null;

    let consumed = false;
    const dataSize = type === 'file' ? entrySize : size;
    const dataPadded = Math.ceil(dataSize / BLOCK) * BLOCK;

    yield {
      entry,
      body: async function* () {
        consumed = true;
        yield* reader.chunks(dataSize);
        await reader.skip(dataPadded - dataSize);
      },
    };

    if (!consumed) await reader.skip(dataPadded);
  }
}

// --- entry planning ----------------------------------------------------------------------------------------------

/** Normalised relative path of an entry (no leading `/`, no `.` / empty components); null = the root itself. */
export function normalizeEntryPath(name: string): string | null {
  if (name.includes('\0')) throw new LayerUnpackError('entry path contains NUL');

  if (name.startsWith('/')) throw new LayerUnpackError(`absolute entry path ${name}`);

  const parts = name.split('/').filter((p) => p !== '' && p !== '.');

  if (parts.includes('..')) throw new LayerUnpackError(`entry path ${name} contains '..'`);

  return parts.length ? parts.join('/') : null;
}

export const WHITEOUT_PREFIX = '.wh.';
export const OPAQUE_WHITEOUT = '.wh..wh..opq';
export const OVERLAY_OPAQUE_XATTR = 'trusted.overlay.opaque';

/** Only these xattrs survive: file capabilities and user attributes (guest semantics, harmless on the host). */
export function keptXattr(name: string): boolean {
  return name === 'security.capability' || name.startsWith('user.');
}

export type EntryAction =
  | { kind: 'skip'; reason: string }
  | { kind: 'drop-device'; path: string }
  | { kind: 'whiteout'; path: string }
  | { kind: 'opaque'; dir: string }
  | { kind: 'dir'; path: string }
  | { kind: 'file'; path: string }
  | { kind: 'symlink'; path: string; target: string }
  | { kind: 'hardlink'; path: string; target: string };

/** What extracting an entry means (no file system access); refusals throw {@link LayerUnpackError}. */
export function planEntry(entry: TarEntry): EntryAction {
  const path = normalizeEntryPath(entry.name);

  if (path === null) return { kind: 'skip', reason: 'archive root' };

  const slash = path.lastIndexOf('/');
  const parent = slash === -1 ? '' : path.slice(0, slash);
  const base = path.slice(slash + 1);

  if (base === OPAQUE_WHITEOUT) return { kind: 'opaque', dir: parent };

  if (base.startsWith(`${WHITEOUT_PREFIX}${WHITEOUT_PREFIX}`)) return { kind: 'skip', reason: `aufs metadata ${path}` };

  if (base.startsWith(WHITEOUT_PREFIX)) {
    const name = base.slice(WHITEOUT_PREFIX.length);

    if (!name || name === '.' || name === '..') throw new LayerUnpackError(`invalid whiteout ${path}`);

    return { kind: 'whiteout', path: parent ? `${parent}/${name}` : name };
  }

  switch (entry.type) {
    case 'char':
    case 'block':
    case 'fifo':
      return { kind: 'drop-device', path };
    case 'dir':
      return { kind: 'dir', path };
    case 'file':
      return { kind: 'file', path };
    case 'symlink':
      if (!entry.linkname || entry.linkname.includes('\0'))
        throw new LayerUnpackError(`invalid symlink target of ${path}`);

      // The target is interpreted in the guest only: the host never follows links inside the cache.
      return { kind: 'symlink', path, target: entry.linkname };
    case 'hardlink': {
      const target = normalizeEntryPath(entry.linkname);

      if (target === null) throw new LayerUnpackError(`hardlink ${path} points to the root`);

      return { kind: 'hardlink', path, target };
    }
  }
}

// --- extraction --------------------------------------------------------------------------------------------------

/** File-system operations the extractor needs beyond Node's `fs` (no `mknod` / `setxattr` there). */
export interface UnpackHostOps {
  /** Overlay whiteout: a char device 0/0 owned by root. */
  mknodWhiteout(path: string): Promise<void>;
  /** Sets an xattr without following symlinks. */
  setXattr(path: string, name: string, value: Buffer): Promise<void>;
  /** Flushes the file system of `path` (`syncfs`). */
  syncfs(path: string): Promise<void>;
}

/** Host operations through coreutils / attr (`mknod`, `setfattr -h`, `sync -f`); never through a shell. */
export function commandUnpackOps(commands: CommandRunner): UnpackHostOps {
  return {
    mknodWhiteout: async (path) => {
      await commands.run('mknod', ['-m', '000', '--', path, 'c', '0', '0']);
    },
    setXattr: async (path, name, value) => {
      await commands.run('setfattr', ['-h', '-n', name, '-v', `0s${value.toString('base64')}`, '--', path]);
    },
    syncfs: async (path) => {
      await commands.run('sync', ['-f', path], { timeoutMs: 600_000 });
    },
  };
}

export interface UnpackResult {
  /** sha256 of the uncompressed tar (`sha256:<hex>`). */
  diffId: string;
  /** sha256 of the blob as received. */
  digest: string;
  /** Uncompressed bytes. */
  bytes: number;
  entries: number;
  droppedDevices: number;
  whiteouts: number;
}

/** Counts bytes and hashes a stream; fails once it exceeds `limit`. */
class Measure extends Transform {
  readonly hash: Hash = createHash('sha256');
  bytes = 0;

  constructor(
    private readonly limit: number,
    private readonly what: string,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytes += chunk.length;

    if (this.bytes > this.limit) {
      callback(new LayerUnpackError(`${this.what} exceeds its limit of ${this.limit} bytes`));

      return;
    }

    this.hash.update(chunk);
    callback(null, chunk);
  }
}

/** zstd decompression (Node ≥ 22.15 / 23.8; the agent's runtime is newer); older runtimes refuse zstd layers. */
function zstdDecompress(): Transform {
  const create = (zlib as unknown as { createZstdDecompress?: () => Transform }).createZstdDecompress;

  if (!create) throw new LayerUnpackError('zstd layers need a newer Node.js runtime');

  return create();
}

/** Small layers compress far better than 8:1 (a tar of empty directories is mostly zero padding). */
const MIN_DECOMPRESSED_LIMIT = 64 * 1024 ** 2;

/**
 * The decompressed-size bound of a layer (decompression bombs): its declared size × 8, at least 64 MiB, capped by the
 * node-wide maximum.
 */
export function decompressedLimit(declaredSize: number, maxBytes: number): number {
  return Math.min(Math.max(declaredSize * 8, MIN_DECOMPRESSED_LIMIT), maxBytes);
}

/**
 * Extracts entries into `root` (the staging directory). Every path is checked against the rules above; parents
 * are created as root-owned 0755 directories when the tar doesn't list them first.
 */
export class LayerExtractor {
  private readonly extracted = new Map<string, 'dir' | 'other'>();
  private readonly dirTimes: { path: string; mtime: number }[] = [];
  readonly counts = { entries: 0, droppedDevices: 0, whiteouts: 0 };

  constructor(
    private readonly root: string,
    private readonly ops: UnpackHostOps,
  ) {}

  private abs(path: string): string {
    return join(this.root, path);
  }

  /** Walks `path`'s parents without following symlinks, creating missing ones. */
  private async parents(path: string): Promise<void> {
    const parts = path.split('/').slice(0, -1);
    let current = '';

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;

      const stat = await lstat(this.abs(current)).catch(() => null);

      if (!stat) {
        await mkdir(this.abs(current), { mode: 0o755 });
        continue;
      }

      if (stat.isSymbolicLink()) throw new LayerUnpackError(`entry path ${path} goes through the symlink ${current}`);

      if (!stat.isDirectory())
        throw new LayerUnpackError(`entry path ${path} goes through the non-directory ${current}`);
    }
  }

  /** Removes what's at `path` unless it is a directory and `keepDir`; returns whether a directory is kept. */
  private async clear(path: string, keepDir: boolean): Promise<boolean> {
    const stat = await lstat(this.abs(path)).catch(() => null);

    if (!stat) return false;

    if (stat.isDirectory() && keepDir) return true;

    await rm(this.abs(path), { recursive: true, force: true });

    return false;
  }

  private async xattrs(path: string, entry: TarEntry): Promise<void> {
    for (const [name, value] of Object.entries(entry.xattrs))
      if (keptXattr(name)) await this.ops.setXattr(this.abs(path), name, value);
  }

  async extract(entry: TarEntry, body: () => AsyncGenerator<Buffer>): Promise<void> {
    const action = planEntry(entry);

    this.counts.entries++;

    switch (action.kind) {
      case 'skip':
        return;
      case 'drop-device':
        this.counts.droppedDevices++;

        return;
      case 'opaque': {
        if (action.dir) await this.parents(`${action.dir}/x`);

        const target = action.dir ? this.abs(action.dir) : this.root;
        const stat = await lstat(target).catch(() => null);

        if (!stat) await mkdir(target, { mode: 0o755 });
        else if (!stat.isDirectory()) throw new LayerUnpackError(`opaque marker in the non-directory ${action.dir}`);

        await this.ops.setXattr(target, OVERLAY_OPAQUE_XATTR, Buffer.from('y'));
        this.counts.whiteouts++;

        return;
      }
      case 'whiteout': {
        await this.parents(action.path);

        // Whiteouts hide lower layers only: an entry of this same layer at that path wins.
        if (this.extracted.has(action.path)) return;

        await this.clear(action.path, false);
        await this.ops.mknodWhiteout(this.abs(action.path));
        this.counts.whiteouts++;

        return;
      }
      case 'dir': {
        await this.parents(action.path);

        if (!(await this.clear(action.path, true))) await mkdir(this.abs(action.path), { mode: 0o700 });

        await lchown(this.abs(action.path), entry.uid, entry.gid);
        await chmod(this.abs(action.path), entry.mode);
        await this.xattrs(action.path, entry);
        this.dirTimes.push({ path: action.path, mtime: entry.mtime });
        this.extracted.set(action.path, 'dir');

        return;
      }
      case 'file': {
        await this.parents(action.path);
        await this.clear(action.path, false);

        const handle = await open(
          this.abs(action.path),
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          0o600,
        );

        try {
          for await (const chunk of body()) await handle.write(chunk);
          // chown before chmod: chown clears setuid / setgid.
          await handle.chown(entry.uid, entry.gid);
          await handle.chmod(entry.mode);
          await handle.utimes(entry.mtime, entry.mtime);
        } finally {
          await handle.close();
        }

        await this.xattrs(action.path, entry);
        this.extracted.set(action.path, 'other');

        return;
      }
      case 'symlink': {
        await this.parents(action.path);
        await this.clear(action.path, false);
        await symlink(action.target, this.abs(action.path));
        await lchown(this.abs(action.path), entry.uid, entry.gid);
        await lutimes(this.abs(action.path), entry.mtime, entry.mtime);
        this.extracted.set(action.path, 'other');

        return;
      }
      case 'hardlink': {
        if (this.extracted.get(action.target) !== 'other')
          throw new LayerUnpackError(
            `hardlink ${action.path} points to ${action.target}, which is not a file extracted from this layer`,
          );

        await this.parents(action.path);
        await this.clear(action.path, false);
        // link(2) doesn't follow a symlink target; the target was checked to be inside this layer.
        await link(this.abs(action.target), this.abs(action.path));
        this.extracted.set(action.path, 'other');

        return;
      }
    }
  }

  /** Directory times last (extracting children changes them). */
  async finish(): Promise<void> {
    for (const { path, mtime } of this.dirTimes.reverse())
      await utimes(this.abs(path), mtime, mtime).catch(() => undefined);
  }
}

export interface UnpackLayerOptions {
  mediaType: string;
  /** Declared (compressed) size from the manifest. */
  size: number;
  /** Node-wide bound of a layer's uncompressed size (`LOADWEAVER_VMROOT_LAYER_MAX_BYTES`). */
  maxBytes: number;
  ops: UnpackHostOps;
}

/**
 * Unpacks a layer blob stream into `staging`: hashes the blob (digest) and the uncompressed tar (diffID), bounds the
 * size, extracts. The caller compares the digests with the manifest and only then publishes the staging dir.
 */
export async function unpackLayerStream(
  blob: Readable,
  staging: string,
  options: UnpackLayerOptions,
): Promise<UnpackResult> {
  const compression = layerCompression(options.mediaType);
  const compressed = new Measure(options.maxBytes, 'layer blob');
  const uncompressed = new Measure(decompressedLimit(options.size, options.maxBytes), 'uncompressed layer');
  const decompress =
    compression === 'gzip' ? zlib.createGunzip() : compression === 'zstd' ? zstdDecompress() : new PassThrough();
  let failure: Error | null = null;

  // `pipeline` destroys every stage on an error, so reading the tar below fails as well.
  pipeline(blob, compressed, decompress, uncompressed, (error) => {
    if (error) failure = error;
  });

  const extractor = new LayerExtractor(staging, options.ops);

  try {
    for await (const { entry, body } of readTar(uncompressed as AsyncIterable<Buffer>))
      await extractor.extract(entry, body);
  } catch (error) {
    uncompressed.destroy();
    throw failure ?? error;
  }

  if (failure) throw failure;

  await extractor.finish();
  await options.ops.syncfs(staging);

  return {
    digest: `sha256:${compressed.hash.digest('hex')}`,
    diffId: `sha256:${uncompressed.hash.digest('hex')}`,
    bytes: uncompressed.bytes,
    ...extractor.counts,
  };
}

// --- confinement of the unpack process ---------------------------------------------------------------------------

/** Mount points of `/proc/self/mountinfo` (field 5, octal escapes decoded). */
export function mountPoints(mountinfo: string): string[] {
  return mountinfo
    .split('\n')
    .map((line) => line.split(' ')[4])
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8))));
}

const PSEUDO_MOUNTS = /^\/(proc|sys|dev)(\/|$)/;

/**
 * Commands that confine the unpack process (already in its own mount + PID namespace, `unshare --mount --pid
 * --fork`): mounts private, the staging directory bind-mounted onto itself (its own mount point), then every other
 * mount re-mounted read-only. Only `staging` stays writable.
 */
export function confinementCommands(mountinfo: string, staging: string): [string, string[]][] {
  const others = [...new Set(mountPoints(mountinfo))]
    .filter((p) => p !== staging && !PSEUDO_MOUNTS.test(p))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));

  return [
    ['mount', ['--make-rprivate', '/']],
    ['mount', ['--bind', staging, staging]],
    ...others.map((p): [string, string[]] => ['mount', ['-o', 'remount,bind,ro', p]]),
  ];
}

/**
 * The agent binary in unpack mode inside fresh mount and PID namespaces (`unshare` from util-linux); the blob is
 * streamed to its stdin, the result comes back as JSON on stdout.
 */
export function unpackCommand(
  agent: readonly string[],
  options: { staging: string; mediaType: string; size: number; maxBytes: number },
): [string, string[]] {
  return [
    'unshare',
    [
      '--mount',
      '--pid',
      '--fork',
      '--kill-child',
      ...agent,
      'unpack-layer',
      '--staging',
      options.staging,
      '--media-type',
      options.mediaType,
      '--size',
      String(options.size),
      '--max-bytes',
      String(options.maxBytes),
    ],
  ];
}

/**
 * `loadweaver-agent unpack-layer …` (internal): confines itself, unpacks stdin into the staging dir and prints the
 * {@link UnpackResult}. Only ever started by the node agent's rootfs cache.
 */
export async function runUnpackLayerCommand(
  args: { staging: string; mediaType: string; size: number; maxBytes: number },
  io: { stdin: Readable; stdout: NodeJS.WritableStream; readMountinfo: () => Promise<string> },
  commands: CommandRunner = new CommandRunner(),
): Promise<void> {
  if (!args.staging.startsWith('/')) throw new LayerUnpackError('staging must be an absolute path');

  for (const [command, argv] of confinementCommands(await io.readMountinfo(), args.staging))
    await commands.run(command, argv);

  const result = await unpackLayerStream(io.stdin, args.staging, {
    mediaType: args.mediaType,
    size: args.size,
    maxBytes: args.maxBytes,
    ops: commandUnpackOps(commands),
  });

  io.stdout.write(`${JSON.stringify(result)}\n`);
}

/** Extraction of an exported file system (scans, probes): no device nodes, whiteouts or xattrs. */
const EXPORT_EXTRACT_OPS: UnpackHostOps = {
  mknodWhiteout: async () => undefined,
  setXattr: async () => undefined,
  syncfs: async () => undefined,
};

function safePath(path: string): string | null {
  try {
    return normalizeEntryPath(path);
  } catch {
    return null;
  }
}

/**
 * Extracts an exported container file system (`docker export`), or only the part below `prefix`, into `target`
 * (paths relative to the prefix) with the unpack rules: no `..`, no paths through symlinks, hardlinks only within the
 * extracted part, no device nodes. Entries that break a rule are skipped. Returns the number of entries taken.
 */
export async function extractExportedTree(
  exported: AsyncIterable<Buffer>,
  prefix: string,
  target: string,
): Promise<number> {
  const base = prefix.replace(/^\/+|\/+$/g, '');
  const inside = (p: string | null): p is string => !!p && (!base || p.startsWith(`${base}/`));
  const relative = (p: string) => (base ? p.slice(base.length + 1) : p);
  const extractor = new LayerExtractor(target, EXPORT_EXTRACT_OPS);
  let count = 0;

  for await (const { entry, body } of readTar(exported)) {
    const path = safePath(entry.name);

    if (!inside(path)) continue;

    const link = entry.type === 'hardlink' ? safePath(entry.linkname) : null;

    // Hardlinks out of the extracted part can't be represented: skipped.
    if (entry.type === 'hardlink' && !inside(link)) continue;

    await extractor
      .extract({ ...entry, name: relative(path), ...(link ? { linkname: relative(link) } : {}) }, body)
      .catch(() => undefined);
    count++;
  }

  await extractor.finish();

  return count;
}
