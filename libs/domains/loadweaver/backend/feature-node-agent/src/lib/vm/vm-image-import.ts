import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, statfs, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable, type Transform } from 'node:stream';
import * as zlib from 'node:zlib';

import type { RegistryClient, VmImageRef } from '@forepath/loadweaver/shared/util-agent-protocol';
import { containerDiskFormat, type VmImageFormat } from '@forepath/loadweaver/shared/util-model';
import { parseImageReference } from '@forepath/loadweaver/shared/util-compose';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { abortError, BackupJobs, JOB_PREFIX } from '../backups/backup-jobs';
import { RegistryBlobSource, type BlobSource } from '../microvm/rootfs-cache';
import { readTar } from '../microvm/rootfs-unpack';
import { RegistryRouter } from '../registry/registry-router';
import { VolumeManager } from '../volumes/volume.manager';

/**
 * VM disk images on the node (3.35, M7.3): the boot disk of a VM is written once from its image when the volume is
 * first promoted (`volumes[].initializeFrom`), and again on an explicit re-image (`vmImageImport`).
 *
 * 1. The image's disk layer is fetched through the cluster (the node's registry router for private / mirrored
 *    images), its sha256 verified against the pinned layer digest while it streams, and stored as a plain disk file
 *    in a content-addressed cache with LRU collection: `<root>/sha256/<hex>` (+ `<hex>.json` marker). Loadweaver
 *    artifacts carry a qcow2 layer (stored as is) or a zstd-compressed raw disk (decompressed, written sparse);
 *    KubeVirt `containerDisk` images (a tar layer, possibly gzip / zstd compressed, with `/disk/<file>.qcow2|.img`)
 *    are recognised by content and their disk file extracted.
 * 2. The launcher image runs in import mode (no network, no capabilities, read-only root, the blob read-only and the
 *    DRBD device as its only device): `qemu-img info` first (format, no backing / data file, virtual size fits the
 *    disk), then `qemu-img convert -n -O raw -t none` onto `/dev/drbd<minor>` (written through DRBD: every replica
 *    gets it).
 * 3. The volume's LV carries `lw.init=<digest>` afterwards (`lw.importing=<digest>` from the decision on, so an
 *    interrupted import on this node is repeated). A replica promoted elsewhere later (failover) finds data on the
 *    volume and adopts it (tags `lw.init` locally) instead of importing again; a disk is never re-imported
 *    automatically once it held data, only through `vmImageImport`.
 *
 * The first import of a boot disk runs as a background job (`BootDiskImports`, F3b): `prepareBootDisk` decides and
 * marks, `importBootDisk` writes (cancellable, with progress).
 */

export interface VmImageCacheConfig {
  root: string;
  /** Cache cap; undefined = 15 % of the file system holding `root`. */
  maxBytes?: number;
}

export const DEFAULT_VM_IMAGE_CACHE_SHARE = 0.15;
const SHA256 = /^sha256:([0-9a-f]{64})$/;
const MIB = 1024 ** 2;
/** Slack over the disk size for a qcow2 file's own metadata (the virtual size is checked exactly by `qemu-img info`). */
const QCOW2_SLACK_BYTES = 256 * MIB;
/** Bound of `qemu-img convert` (a large disk over slow storage). */
const CONVERT_TIMEOUT_MS = 6 * 3600_000;
const INFO_TIMEOUT_MS = 120_000;
/** How often the progress of `qemu-img convert -p` is read. */
const CONVERT_PROGRESS_MS = 5_000;
const IMPORT_MEMORY_BYTES = 1024 ** 3;
/** Where the import container sees the cached disk file. */
const IMPORT_SOURCE = '/import/disk';

export const INIT_TAG_PREFIX = 'lw.init=';
export const IMPORTING_TAG_PREFIX = 'lw.importing=';

export function vmImageCacheConfig(env: NodeJS.ProcessEnv = process.env): VmImageCacheConfig {
  const max = Number(env['LOADWEAVER_VMIMAGE_CACHE_MAX_BYTES']);

  return {
    root: env['LOADWEAVER_VMIMAGE_DIR'] || '/var/lib/loadweaver/vmimages',
    ...(Number.isSafeInteger(max) && max > 0 ? { maxBytes: max } : {}),
  };
}

function hexOf(digest: string): string {
  const match = SHA256.exec(digest);

  if (!match) throw new Error(`invalid digest ${digest}`);

  return match[1];
}

export function cachedDiskPath(config: Pick<VmImageCacheConfig, 'root'>, digest: string): string {
  return join(config.root, 'sha256', hexOf(digest));
}

export function cacheMarkerPath(config: Pick<VmImageCacheConfig, 'root'>, digest: string): string {
  return `${cachedDiskPath(config, digest)}.json`;
}

export const initTag = (digest: string) => `${INIT_TAG_PREFIX}${digest}`;
export const importingTag = (digest: string) => `${IMPORTING_TAG_PREFIX}${digest}`;

/** The initialization marker of a block volume's LV tags. */
export function initMarker(tags: readonly string[]): { initialized?: string; importing?: string } {
  const initialized = tags.find((t) => t.startsWith(INIT_TAG_PREFIX))?.slice(INIT_TAG_PREFIX.length);
  const importing = tags.find((t) => t.startsWith(IMPORTING_TAG_PREFIX))?.slice(IMPORTING_TAG_PREFIX.length);

  return { ...(initialized ? { initialized } : {}), ...(importing ? { importing } : {}) };
}

/** Progress of one import: the layer download, then the write onto the disk. */
export interface VmImportStep {
  phase: 'fetching' | 'writing';
  bytes: number;
  totalBytes?: number;
}

export interface VmImportOptions {
  /** Cancels the import (the write container is killed; a shared download goes on for the cache). */
  signal?: AbortSignal;
  progress?: (step: VmImportStep) => void;
}

/** The last percentage `qemu-img convert -p` printed (`    (12.34/100%)\r`), as a fraction. */
export function convertProgress(stdout: string): number | null {
  const matches = [...stdout.matchAll(/\((\d+(?:\.\d+)?)\/100%\)/g)];
  const last = matches.at(-1);

  return last ? Math.min(1, Math.max(0, Number(last[1]) / 100)) : null;
}

/** Waits for `promise`, unless `signal` aborts first. */
async function unlessAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise;

  if (signal.aborted) throw abortError(signal);

  let onAbort: (() => void) | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(abortError(signal));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

// --- blob → disk file ------------------------------------------------------------------------------------------

export type BlobEncoding = 'gzip' | 'zstd' | 'none';

/** Compression of a blob from its first bytes. */
export function blobEncoding(head: Buffer): BlobEncoding {
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'gzip';

  if (head.length >= 4 && head.readUInt32LE(0) === 0xfd2fb528) return 'zstd';

  return 'none';
}

/** qcow2 magic `QFI\xfb`. */
export function isQcow2(head: Buffer): boolean {
  return head.length >= 4 && head.readUInt32BE(0) === 0x514649fb;
}

/** A ustar / GNU tar header block: magic at 257 and a matching header checksum. */
export function isTarHeader(block: Buffer): boolean {
  if (block.length < 512 || block.subarray(257, 262).toString('latin1') !== 'ustar') return false;

  const stored = parseInt(block.subarray(148, 156).toString('latin1').replace(/\0.*$/, '').trim(), 8);
  let sum = 0;

  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];

  return Number.isInteger(stored) && stored === sum;
}

/** Collects at least `n` bytes from an iterator (fewer at its end); returns them and the iterator to continue. */
async function peek(source: AsyncIterator<Buffer>, n: number): Promise<{ head: Buffer; rest: AsyncGenerator<Buffer> }> {
  const chunks: Buffer[] = [];
  let length = 0;
  let done = false;

  while (length < n) {
    const next = await source.next();

    if (next.done) {
      done = true;
      break;
    }

    const chunk = Buffer.from(next.value);

    chunks.push(chunk);
    length += chunk.length;
  }

  const head = Buffer.concat(chunks);

  return {
    head,
    rest: (async function* () {
      if (head.length) yield head;

      if (done) return;

      for (;;) {
        const next = await source.next();

        if (next.done) return;

        yield Buffer.from(next.value);
      }
    })(),
  };
}

function decompressor(encoding: BlobEncoding): Transform {
  if (encoding === 'gzip') return zlib.createGunzip();

  if (encoding === 'zstd') {
    const create = (zlib as unknown as { createZstdDecompress?: () => Transform }).createZstdDecompress;

    if (!create) throw new Error('zstd VM images need a newer Node.js runtime');

    return create();
  }

  return new PassThrough();
}

/**
 * A disk file written in 1 MiB blocks; all-zero blocks are skipped (a raw disk's empty space stays a hole). Refuses
 * to grow beyond `maxBytes`.
 */
export class SparseFileWriter {
  static readonly BLOCK = MIB;
  private static readonly ZERO = Buffer.alloc(SparseFileWriter.BLOCK);
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private position = 0;

  private constructor(
    private readonly handle: Awaited<ReturnType<typeof open>>,
    private readonly maxBytes: number,
  ) {}

  static async create(path: string, maxBytes: number): Promise<SparseFileWriter> {
    return new SparseFileWriter(await open(path, 'wx', 0o600), maxBytes);
  }

  get bytes(): number {
    return this.position + this.pendingBytes;
  }

  async write(chunk: Buffer): Promise<void> {
    if (this.bytes + chunk.length > this.maxBytes)
      throw new Error(`the VM image is larger than its disk (${this.maxBytes} bytes)`);

    this.pending.push(chunk);
    this.pendingBytes += chunk.length;

    if (this.pendingBytes < SparseFileWriter.BLOCK) return;

    let data = Buffer.concat(this.pending);

    while (data.length >= SparseFileWriter.BLOCK) {
      await this.block(data.subarray(0, SparseFileWriter.BLOCK));
      data = data.subarray(SparseFileWriter.BLOCK);
    }

    this.pending = data.length ? [Buffer.from(data)] : [];
    this.pendingBytes = data.length;
  }

  private async block(block: Buffer): Promise<void> {
    if (!SparseFileWriter.ZERO.subarray(0, block.length).equals(block))
      await this.handle.write(block, 0, block.length, this.position);

    this.position += block.length;
  }

  /** Writes the rest, sets the final size (trailing holes) and syncs; returns the file size. */
  async finish(): Promise<number> {
    if (this.pendingBytes) await this.block(Buffer.concat(this.pending));

    this.pending = [];
    this.pendingBytes = 0;
    await this.handle.truncate(this.position);
    await this.handle.sync();
    await this.handle.close();

    return this.position;
  }

  async abort(): Promise<void> {
    await this.handle.close().catch(() => undefined);
  }
}

/**
 * Streams a disk layer blob into a disk file: sha256 of the blob verified against `digest`, decompressed (gzip /
 * zstd by magic), a KubeVirt containerDisk's `/disk/*` file extracted from its tar. Returns the disk's format (qcow2
 * by magic, a containerDisk by file name, else raw — only for `raw` images) and size.
 */
export async function writeDiskFile(
  blob: AsyncIterable<Buffer>,
  target: string,
  options: { digest: string; format: VmImageFormat; maxBytes: number; onBytes?: (bytes: number) => void },
): Promise<{ format: VmImageFormat; bytes: number }> {
  const expected = hexOf(options.digest);
  const hash = createHash('sha256');
  const onBytes = options.onBytes;
  const hashed = (async function* () {
    let received = 0;

    for await (const chunk of blob) {
      const buffer = Buffer.from(chunk);

      hash.update(buffer);
      received += buffer.length;
      onBytes?.(received);
      yield buffer;
    }
  })();
  const compressed = await peek(hashed, 4);
  const encoding = blobEncoding(compressed.head);
  const plain = Readable.from(compressed.rest).pipe(decompressor(encoding)) as AsyncIterable<Buffer>;
  const { head, rest } = await peek(plain[Symbol.asyncIterator](), 512);
  const writer = await SparseFileWriter.create(target, options.maxBytes + QCOW2_SLACK_BYTES);
  let format: VmImageFormat;

  try {
    if (isQcow2(head)) {
      format = 'qcow2';

      for await (const chunk of rest) await writer.write(chunk);
    } else if (isTarHeader(head)) {
      let found: VmImageFormat | null = null;

      // A containerDisk: the first `/disk/<file>.qcow2|.img`; every other entry is skipped (but read, for the digest).
      for await (const { entry, body } of readTar(rest)) {
        const diskFormat = entry.type === 'file' ? containerDiskFormat(entry.name) : null;

        if (!diskFormat || found) continue;

        found = diskFormat;

        for await (const chunk of body()) await writer.write(chunk);
      }

      if (!found) throw new Error('the image layer is a tar without /disk/*.qcow2 or /disk/*.img (no containerDisk)');

      format = found;
    } else if (options.format === 'raw' && encoding !== 'none') {
      format = 'raw';

      for await (const chunk of rest) await writer.write(chunk);
    } else {
      throw new Error(`the image layer is no ${options.format} disk`);
    }

    // Whatever follows the payload still counts for the digest.
    for await (const chunk of hashed) void chunk;

    const bytes = await writer.finish();
    const actual = hash.digest('hex');

    if (actual !== expected) throw new Error(`digest mismatch: expected sha256:${expected}, got sha256:${actual}`);

    if (format === 'raw' && bytes > options.maxBytes)
      throw new Error(`the VM image is larger than its disk (${options.maxBytes} bytes)`);

    return { format, bytes };
  } catch (error) {
    await writer.abort();
    await rm(target, { force: true });
    throw error;
  }
}

/** `qemu-img info --output=json` of the import source. */
interface QemuImgInfo {
  format?: string;
  'virtual-size'?: number;
  'backing-filename'?: string;
  'full-backing-filename'?: string;
  'format-specific'?: { type?: string; data?: { 'data-file'?: string } };
}

/** Checks the image the converter is about to write: format, no external files, virtual size fits the disk. */
export function checkImageInfo(stdout: string, format: VmImageFormat, deviceBytes: number): QemuImgInfo {
  let info: QemuImgInfo;

  try {
    info = JSON.parse(stdout) as QemuImgInfo;
  } catch {
    throw new Error('qemu-img info printed no JSON');
  }

  if (info.format !== format) throw new Error(`the image is ${info.format ?? 'unknown'}, not ${format}`);

  if (info['backing-filename'] || info['full-backing-filename'])
    throw new Error('the image references a backing file; VM images must be self-contained');

  if (info['format-specific']?.data?.['data-file'])
    throw new Error('the image references an external data file; VM images must be self-contained');

  const virtual = info['virtual-size'];

  if (typeof virtual !== 'number' || virtual <= 0) throw new Error('the image has no virtual size');

  if (virtual > deviceBytes)
    throw new Error(`the image's virtual size (${virtual} bytes) exceeds the disk (${deviceBytes} bytes)`);

  return info;
}

interface CacheMarker {
  digest: string;
  format: VmImageFormat;
  bytes: number;
  fetchedAt: string;
  usedAt: number;
}

export const VM_IMAGE_BLOB_SOURCE = Symbol('VM_IMAGE_BLOB_SOURCE');
export const VM_IMAGE_CACHE_CONFIG = Symbol('VM_IMAGE_CACHE_CONFIG');

@Injectable()
export class VmImageImporter {
  private readonly logger = new Logger(VmImageImporter.name);
  private readonly config: VmImageCacheConfig;
  private readonly source: BlobSource;
  /** In-flight fetches by layer digest (two VMs of one image share the download; progress goes to the first). */
  private readonly fetches = new Map<string, Promise<{ path: string; format: VmImageFormat }>>();
  /** In-flight imports by volume id. */
  private readonly imports = new Map<string, Promise<void>>();

  constructor(
    private readonly volumes: VolumeManager,
    private readonly jobs: BackupJobs,
    @Optional() private readonly router?: RegistryRouter,
    @Optional() @Inject(VM_IMAGE_BLOB_SOURCE) source?: BlobSource,
    @Optional() @Inject(VM_IMAGE_CACHE_CONFIG) config?: VmImageCacheConfig,
  ) {
    this.source = source ?? new RegistryBlobSource();
    this.config = config ?? vmImageCacheConfig();
  }

  /**
   * Promotes a VM boot disk and decides whether its image must be written first: `import` is set when the volume
   * (with `initializeFrom`) never held data or an import on this node was interrupted. The disk is marked
   * `lw.importing=<digest>` right here, before any write is queued: an agent restart before the job ran must repeat
   * the import, not adopt the (empty) disk as data.
   */
  async prepareBootDisk(
    volumeId: string,
  ): Promise<{ device: string; import?: { digest: string; format: VmImageFormat } }> {
    const volume = this.volumes.assignment(volumeId);

    if (!volume) throw new Error(`volume ${volumeId} has no replica on this node`);

    const tags = await this.volumes.lvTags(volumeId);
    const marker = initMarker(tags);
    const { device, fresh } = await this.volumes.promoteBlock(volumeId);
    const init = volume.initializeFrom;

    if (!init) return { device };

    if (marker.initialized && !marker.importing) return { device };

    if (!fresh && !marker.importing) {
      // Promoted here after a failover / move: the disk already holds the VM's data (written by another replica).
      await this.volumes.setLvTags(volumeId, [initTag(init.digest)]);
      this.logger.log(`VM disk ${volumeId} holds data already: adopted as initialized from ${init.digest}`);

      return { device };
    }

    if (marker.importing !== init.digest)
      await this.volumes.setLvTags(
        volumeId,
        [importingTag(init.digest)],
        tags.filter((t) => t.startsWith(INIT_TAG_PREFIX) || t.startsWith(IMPORTING_TAG_PREFIX)),
      );

    return { device, import: { digest: init.digest, format: init.format } };
  }

  /** Writes a boot disk prepared by `prepareBootDisk` from its image (the background job's work). */
  async importBootDisk(
    volumeId: string,
    device: string,
    layer: { ref: string; digest: string; format: VmImageFormat },
    launcherImage: string,
    options: VmImportOptions = {},
  ): Promise<void> {
    await this.importOnce(volumeId, device, layer, launcherImage, options);
  }

  /**
   * `prepareBootDisk` and the import in one call (synchronous; the agent's reconcile uses the background job).
   * Returns the DRBD device for the launcher.
   */
  async ensureInitialized(volumeId: string, image: VmImageRef, launcherImage: string): Promise<string> {
    const prepared = await this.prepareBootDisk(volumeId);

    if (prepared.import)
      await this.importBootDisk(volumeId, prepared.device, { ref: image.ref, ...prepared.import }, launcherImage);

    return prepared.device;
  }

  /**
   * Re-images a (stopped) VM's disk from `image` (`vmImageImport`): promoted for the write, demoted afterwards. The
   * caller made sure no launcher uses the disk.
   */
  async reimage(volumeId: string, image: VmImageRef, launcherImage: string): Promise<void> {
    const volume = this.volumes.assignment(volumeId);

    if (!volume) throw new Error(`volume ${volumeId} has no replica on this node`);

    if (volume.mode !== 'block') throw new Error(`volume ${volumeId} is not a VM disk`);

    const { device } = await this.volumes.promoteBlock(volumeId);
    const write = () =>
      this.importOnce(
        volumeId,
        device,
        { ref: image.ref, digest: image.layerDigest, format: image.format },
        launcherImage,
      );

    try {
      const ref = parseImageReference(image.ref);

      // The VM is stopped: no workload on the node uses its image, the router serves it for the import only.
      if (this.router && ref) await this.router.withRepository(ref.repository, write);
      else await write();
    } finally {
      await this.volumes.demoteBlock(volumeId);
    }
  }

  private async importOnce(
    volumeId: string,
    device: string,
    layer: { ref: string; digest: string; format: VmImageFormat },
    launcherImage: string,
    options: VmImportOptions = {},
  ): Promise<void> {
    const running = this.imports.get(volumeId);

    if (running) return await unlessAborted(running, options.signal);

    const task = this.importNow(volumeId, device, layer, launcherImage, options);

    this.imports.set(volumeId, task);

    try {
      await task;
    } finally {
      this.imports.delete(volumeId);
    }
  }

  private async importNow(
    volumeId: string,
    device: string,
    layer: { ref: string; digest: string; format: VmImageFormat },
    launcherImage: string,
    options: VmImportOptions = {},
  ): Promise<void> {
    const { signal, progress } = options;
    const tags = await this.volumes.lvTags(volumeId);
    const stale = tags.filter((t) => t.startsWith(INIT_TAG_PREFIX) || t.startsWith(IMPORTING_TAG_PREFIX));

    // Marked first: an interrupted import (agent / node crash) is repeated on this node, never adopted.
    await this.volumes.setLvTags(volumeId, [importingTag(layer.digest)], stale);

    const deviceBytes = await this.volumes.blockSizeBytes(volumeId);

    progress?.({ phase: 'fetching', bytes: 0 });

    const disk = await unlessAborted(
      this.fetch(layer.ref, layer.digest, layer.format, deviceBytes, (bytes) =>
        progress?.({ phase: 'fetching', bytes }),
      ),
      signal,
    );
    const name = `${JOB_PREFIX}img-${randomBytes(4).toString('hex')}`;
    const run = (args: string[], timeoutMs: number, onStdout?: (stdout: string) => void) =>
      this.jobs.run({
        name,
        image: launcherImage,
        entrypoint: ['/usr/bin/qemu-img'],
        cmd: args,
        binds: [`${disk.path}:${IMPORT_SOURCE}:ro`],
        devices: [{ path: device, permissions: 'rw' }],
        user: '0:0',
        readOnly: true,
        network: 'none',
        capAdd: [],
        memoryBytes: IMPORT_MEMORY_BYTES,
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(onStdout ? { progress: { intervalMs: CONVERT_PROGRESS_MS, stdout: onStdout } } : {}),
      });

    this.logger.log(`Importing ${layer.ref} (${layer.digest}, ${disk.format}) onto VM disk ${volumeId} (${device})`);

    const info = await run(['info', '--output=json', '-f', disk.format, IMPORT_SOURCE], INFO_TIMEOUT_MS);

    if (info.exitCode !== 0)
      throw new Error(`qemu-img info failed (exit ${info.exitCode ?? 'timeout'}): ${info.stderr.trim().slice(-500)}`);

    const virtualBytes = checkImageInfo(info.stdout, disk.format, deviceBytes)['virtual-size'] as number;

    progress?.({ phase: 'writing', bytes: 0, totalBytes: virtualBytes });

    const convert = await run(
      ['convert', '-p', '-n', '-f', disk.format, '-O', 'raw', '-t', 'none', IMPORT_SOURCE, device],
      CONVERT_TIMEOUT_MS,
      progress
        ? (stdout) => {
            const done = convertProgress(stdout);

            if (done !== null)
              progress({ phase: 'writing', bytes: Math.floor(done * virtualBytes), totalBytes: virtualBytes });
          }
        : undefined,
    );

    if (convert.exitCode !== 0)
      throw new Error(
        `qemu-img convert failed (exit ${convert.exitCode ?? 'timeout'}): ${convert.stderr.trim().slice(-500)}`,
      );

    progress?.({ phase: 'writing', bytes: virtualBytes, totalBytes: virtualBytes });
    await this.volumes.setLvTags(volumeId, [initTag(layer.digest)], [importingTag(layer.digest)]);
    this.logger.log(`VM disk ${volumeId} initialized from ${layer.digest}`);
  }

  // --- cache ---------------------------------------------------------------------------------------------------

  /** The cached disk file of a layer (fetched and verified first if needed). */
  async fetch(
    ref: string,
    digest: string,
    format: VmImageFormat,
    maxBytes: number,
    onBytes?: (bytes: number) => void,
  ): Promise<{ path: string; format: VmImageFormat }> {
    const running = this.fetches.get(digest);

    if (running) return await running;

    const task = this.fetchNow(ref, digest, format, maxBytes, onBytes);

    this.fetches.set(digest, task);

    try {
      return await task;
    } finally {
      this.fetches.delete(digest);
    }
  }

  private async marker(digest: string): Promise<CacheMarker | null> {
    try {
      const marker = JSON.parse(await readFile(cacheMarkerPath(this.config, digest), 'utf8')) as CacheMarker;

      return marker.digest === digest ? marker : null;
    } catch {
      return null;
    }
  }

  private async fetchNow(
    ref: string,
    digest: string,
    format: VmImageFormat,
    maxBytes: number,
    onBytes?: (bytes: number) => void,
  ): Promise<{ path: string; format: VmImageFormat }> {
    const path = cachedDiskPath(this.config, digest);
    const cached = await this.marker(digest);

    if (cached && (await stat(path).catch(() => null))) {
      await this.touch(cached);

      return { path, format: cached.format };
    }

    await mkdir(join(this.config.root, 'sha256'), { recursive: true, mode: 0o700 });
    await mkdir(join(this.config.root, 'staging'), { recursive: true, mode: 0o700 });
    await this.gc(new Set([digest]), maxBytes).catch((error: unknown) =>
      this.logger.warn(`VM image cache GC failed: ${(error as Error).message}`),
    );

    const staging = join(this.config.root, 'staging', `${hexOf(digest)}.${randomBytes(4).toString('hex')}`);
    const registry: RegistryClient | undefined = this.router?.registryClient ?? undefined;
    const blob = await this.source.open(ref, digest, registry);
    const written = await writeDiskFile(blob as AsyncIterable<Buffer>, staging, {
      digest,
      format,
      maxBytes,
      ...(onBytes ? { onBytes } : {}),
    });

    await rename(staging, path);

    const marker: CacheMarker = {
      digest,
      format: written.format,
      bytes: written.bytes,
      fetchedAt: new Date().toISOString(),
      usedAt: Date.now(),
    };

    await writeFile(cacheMarkerPath(this.config, digest), JSON.stringify(marker), { mode: 0o600 });
    this.logger.log(`Cached VM image layer ${digest} (${written.format}, ${written.bytes} bytes)`);

    return { path, format: written.format };
  }

  private async touch(marker: CacheMarker): Promise<void> {
    const file = cacheMarkerPath(this.config, marker.digest);

    await writeFile(file, JSON.stringify({ ...marker, usedAt: Date.now() }), { mode: 0o600 }).catch(() => undefined);
    await utimes(cachedDiskPath(this.config, marker.digest), new Date(), new Date()).catch(() => undefined);
  }

  /** The cache's cap: configured, or a share of its file system. */
  async capBytes(): Promise<number> {
    if (this.config.maxBytes) return this.config.maxBytes;

    const fs = await statfs(this.config.root);

    return Math.floor(Number(fs.blocks) * Number(fs.bsize) * DEFAULT_VM_IMAGE_CACHE_SHARE);
  }

  /**
   * Removes least recently used entries (never `keep`, never one being fetched) until the cache plus `incoming`
   * bytes fit its cap; leftovers in `staging/` go too. Returns the removed digests.
   */
  async gc(keep: ReadonlySet<string> = new Set(), incoming = 0): Promise<string[]> {
    const dir = join(this.config.root, 'sha256');
    const names = await readdir(dir).catch(() => [] as string[]);
    const entries: { digest: string; bytes: number; usedAt: number }[] = [];

    for (const name of names) {
      if (!name.endsWith('.json')) continue;

      const marker = await this.marker(`sha256:${name.slice(0, -5)}`);

      if (!marker) continue;

      // Holes don't count: the space a sparse raw disk really takes.
      const info = await stat(cachedDiskPath(this.config, marker.digest)).catch(() => null);

      entries.push({ digest: marker.digest, bytes: info ? info.blocks * 512 : 0, usedAt: marker.usedAt });
    }

    // Staging files of fetches that died with an earlier agent process (or failed without cleanup).
    const inFlight = new Set([...this.fetches.keys()].map((d) => hexOf(d)));

    for (const name of await readdir(join(this.config.root, 'staging')).catch(() => [] as string[]))
      if (!inFlight.has(name.split('.')[0]))
        await rm(join(this.config.root, 'staging', name), { force: true }).catch(() => undefined);

    const cap = await this.capBytes();
    let total = entries.reduce((sum, e) => sum + e.bytes, 0) + incoming;
    const removed: string[] = [];

    for (const entry of entries.sort((a, b) => a.usedAt - b.usedAt)) {
      if (total <= cap) break;

      if (keep.has(entry.digest) || this.fetches.has(entry.digest)) continue;

      await rm(cachedDiskPath(this.config, entry.digest), { force: true });
      await rm(cacheMarkerPath(this.config, entry.digest), { force: true });
      total -= entry.bytes;
      removed.push(entry.digest);
    }

    if (removed.length) this.logger.log(`VM image cache: removed ${removed.length} unused layer(s)`);

    return removed;
  }
}
