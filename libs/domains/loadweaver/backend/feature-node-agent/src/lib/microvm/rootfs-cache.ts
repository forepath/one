import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSea } from 'node:sea';
import { Readable } from 'node:stream';

import type { MicrovmArchitecture, MicrovmSpec, RegistryClient } from '@forepath/loadweaver/shared/util-agent-protocol';
import { parseImageReference, registryApiHost } from '@forepath/loadweaver/shared/util-compose';
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { storageConfig, VolumeManager } from '../volumes/volume.manager';
import { LayerUnpackError, layerCompression, unpackCommand, type UnpackResult } from './rootfs-unpack';

/**
 * Image unpack cache of generic microVMs (3.35, M7.2): each image layer is unpacked once per node into a
 * content-addressed, read-only directory (by diffID, so equal content from different compressions is shared), and
 * every replica gets an overlay of its image's layers plus its own writable layer, which the launcher container
 * bind-mounts as `/guest` (the guest root, served over virtio-fs).
 *
 * Layout (`LOADWEAVER_VMROOT_DIR`, default `/var/lib/loadweaver/vmroot`, root 0700):
 * - `layers/sha256/<hex>/` an unpacked layer; `layers/sha256/<hex>.json` its completion marker `{digest, diffId,
 *   bytes, unpackedAt, usedAt}` (next to the directory: a marker inside would show up in the guest root);
 * - `replicas/<key>/` the writable layer's backing file (loop fallback) and, mounted on `rw/`, `upper/` + `work/`;
 * - `staging/` in-progress unpacks.
 *
 * The overlay itself (`merged`) is mounted below the agent's runtime dir on tmpfs (`/run/loadweaver/vmroot/<key>`):
 * after a reboot the bind source doesn't exist, so Docker can't restart a launcher on an empty guest root before the
 * agent mounted it again.
 */

export interface VmrootConfig {
  root: string;
  /** Where the overlays are mounted (tmpfs). */
  mountRoot: string;
  /** Cache cap; undefined = 15 % of the file system holding `root`. */
  cacheMaxBytes?: number;
  /** Bound of one layer's uncompressed size. */
  layerMaxBytes: number;
}

const GIB = 1024 ** 3;
export const DEFAULT_LAYER_MAX_BYTES = 16 * GIB;
/** Share of the cache's file system the cache may use when no cap is configured. */
export const DEFAULT_CACHE_SHARE = 0.15;
/** Linux limit of mount option data (one page); longer `lowerdir` lists can't be mounted. */
const MAX_MOUNT_OPTIONS = 4000;
const SHA256 = /^sha256:([0-9a-f]{64})$/;

function positive(value: string | undefined): number | undefined {
  const n = value ? Number(value) : NaN;

  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export function vmrootConfig(env: NodeJS.ProcessEnv = process.env): VmrootConfig {
  const cacheMaxBytes = positive(env['LOADWEAVER_VMROOT_CACHE_MAX_BYTES']);

  return {
    root: env['LOADWEAVER_VMROOT_DIR'] || '/var/lib/loadweaver/vmroot',
    mountRoot: join(env['LOADWEAVER_RUNTIME_DIR'] || '/run/loadweaver', 'vmroot'),
    ...(cacheMaxBytes ? { cacheMaxBytes } : {}),
    layerMaxBytes: positive(env['LOADWEAVER_VMROOT_LAYER_MAX_BYTES']) ?? DEFAULT_LAYER_MAX_BYTES,
  };
}

/** Per-replica key (directory and LV names): the first 24 hex digits of sha256(workload id). */
export function replicaKey(workloadId: string): string {
  return createHash('sha256').update(workloadId).digest('hex').slice(0, 24);
}

function hexOf(diffId: string): string {
  const match = SHA256.exec(diffId);

  if (!match) throw new LayerUnpackError(`invalid layer digest ${diffId}`);

  return match[1];
}

export function layerDir(config: Pick<VmrootConfig, 'root'>, diffId: string): string {
  return join(config.root, 'layers', 'sha256', hexOf(diffId));
}

export function layerMarker(config: Pick<VmrootConfig, 'root'>, diffId: string): string {
  return `${layerDir(config, diffId)}.json`;
}

export interface ReplicaPaths {
  key: string;
  dir: string;
  /** Mount point of the writable layer's file system. */
  rw: string;
  upper: string;
  work: string;
  /** Loop fallback's backing file. */
  image: string;
  /** The overlay (tmpfs mount point): what the launcher sees as `/guest`. */
  merged: string;
  /** Thin LV of the writable layer. */
  lv: string;
}

export function replicaPaths(config: Pick<VmrootConfig, 'root' | 'mountRoot'>, workloadId: string): ReplicaPaths {
  const key = replicaKey(workloadId);
  const dir = join(config.root, 'replicas', key);

  return {
    key,
    dir,
    rw: join(dir, 'rw'),
    upper: join(dir, 'rw', 'upper'),
    work: join(dir, 'rw', 'work'),
    image: join(dir, 'rw.img'),
    merged: join(config.mountRoot, key, 'merged'),
    lv: `lw-vmrw-${key}`,
  };
}

/** Mount options of a replica's overlay; `layers` in image order (base first), overlay wants the top first. */
export function overlayMountOptions(
  config: Pick<VmrootConfig, 'root'>,
  layers: readonly Pick<MicrovmLayer, 'diffId'>[],
  paths: Pick<ReplicaPaths, 'upper' | 'work'>,
): string {
  if (layers.length === 0) throw new LayerUnpackError('a microVM image needs at least one layer');

  const lower = [...layers].reverse().map((l) => layerDir(config, l.diffId));
  const options = [
    `lowerdir=${lower.join(':')}`,
    `upperdir=${paths.upper}`,
    `workdir=${paths.work}`,
    'nosuid',
    'nodev',
    'noexec',
    'index=off',
    'redirect_dir=off',
    'metacopy=off',
  ].join(',');

  if (options.length > MAX_MOUNT_OPTIONS)
    throw new LayerUnpackError(
      `E_MICROVM_IMAGE_UNSUPPORTED: the image has too many layers (${layers.length}) for one overlay mount`,
    );

  return options;
}

export type MicrovmLayer = NonNullable<MicrovmSpec['layers']>[number];

/** This node's architecture in OCI terms; null for architectures microVMs don't support. */
export function nodeArchitecture(arch: string = process.arch): MicrovmArchitecture | null {
  return arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
}

/**
 * The guest image layers for this node: its architecture's list of a multi-arch image (`platformLayers`), else the
 * single-architecture `layers`. A multi-arch image without the node's architecture is refused.
 */
export function guestLayers(
  microvm: Pick<MicrovmSpec, 'layers' | 'platformLayers'>,
  arch: MicrovmArchitecture | null = nodeArchitecture(),
): MicrovmLayer[] {
  if (microvm.platformLayers) {
    const layers = arch ? microvm.platformLayers[arch] : undefined;

    if (!layers?.length)
      throw new LayerUnpackError(
        `E_MICROVM_IMAGE_UNSUPPORTED: the guest image has no ${arch ?? process.arch} variant (available: ${Object.keys(microvm.platformLayers).join(', ') || 'none'})`,
      );

    return layers;
  }

  return microvm.layers ?? [];
}

interface LayerMarker {
  digest: string;
  diffId: string;
  bytes: number;
  unpackedAt: string;
  usedAt: string;
}

/** Mount points from `/proc/self/mountinfo` with their file system type and super options. */
export function parseMountinfo(mountinfo: string): { mountPoint: string; fsType: string; superOptions: string }[] {
  const unescape = (p: string) => p.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));

  return mountinfo
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const fields = line.split(' ');
      const dash = fields.indexOf('-');

      if (dash === -1 || !fields[4]) return [];

      return [
        { mountPoint: unescape(fields[4]), fsType: fields[dash + 1] ?? '', superOptions: fields[dash + 3] ?? '' },
      ];
    });
}

/** Layer hexes the mounted overlays below `root` use (never collected while mounted). */
export function mountedLayers(mountinfo: string, root: string): Set<string> {
  const prefix = join(root, 'layers', 'sha256');
  const used = new Set<string>();

  for (const m of parseMountinfo(mountinfo).filter((x) => x.fsType === 'overlay')) {
    const lower = /(?:^|,)lowerdir=([^,]*)/.exec(m.superOptions)?.[1] ?? '';

    for (const dir of lower.split(':'))
      if (dir.startsWith(`${prefix}/`)) used.add(dir.slice(prefix.length + 1).replace(/\/$/, ''));
  }

  return used;
}

/** Layers to remove so the cache fits its cap: unreferenced ones, least recently used first. */
export function layersToCollect(
  layers: readonly { hex: string; bytes: number; usedAt: number }[],
  referenced: ReadonlySet<string>,
  capBytes: number,
): string[] {
  let total = layers.reduce((sum, l) => sum + l.bytes, 0);
  const victims: string[] = [];

  for (const layer of [...layers].filter((l) => !referenced.has(l.hex)).sort((a, b) => a.usedAt - b.usedAt)) {
    if (total <= capBytes) break;

    victims.push(layer.hex);
    total -= layer.bytes;
  }

  return victims;
}

/** Streams a layer blob (digest-addressed) of an image. */
export interface BlobSource {
  open(image: string, digest: string, registry: RegistryClient | undefined): Promise<Readable>;
}

/** Unpacks a blob stream into a staging directory (confined child process in production). */
export interface LayerUnpacker {
  unpack(
    blob: Readable,
    options: { staging: string; mediaType: string; size: number; maxBytes: number },
  ): Promise<UnpackResult>;
}

/** `WWW-Authenticate: Bearer realm=…,service=…,scope=…` → token URL (anonymous pulls of public registries). */
export function bearerTokenUrl(header: string | null): string | null {
  if (!header || !/^bearer\s/i.test(header)) return null;

  const params = new Map<string, string>();

  for (const match of header.slice(7).matchAll(/([a-z]+)="([^"]*)"/gi)) params.set(match[1].toLowerCase(), match[2]);

  const realm = params.get('realm');

  if (!realm || !/^https:\/\//.test(realm)) return null;

  const url = new URL(realm);

  for (const key of ['service', 'scope']) {
    const value = params.get(key);

    if (value) url.searchParams.set(key, value);
  }

  return url.toString();
}

/**
 * Blobs come from the same place Docker pulls from (3.22): mirrored and private images through the node's loopback
 * router (which adds the node's pull token), everything else from its registry directly (anonymous token flow).
 * Docker's own store is never used: it hides containerd's snapshot formats.
 */
export class RegistryBlobSource implements BlobSource {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  blobUrl(image: string, digest: string, registry: RegistryClient | undefined): string {
    const ref = parseImageReference(image);

    if (!ref) throw new LayerUnpackError(`invalid image reference ${image}`);

    hexOf(digest);

    const routed = registry && (ref.host === registry.privateHost || registry.mirrors.some((m) => m.host === ref.host));

    return routed
      ? `http://127.0.0.1:${registry.routerPort}/v2/${ref.host}/${ref.repository}/blobs/${digest}`
      : `https://${registryApiHost(ref.host)}/v2/${ref.repository}/blobs/${digest}`;
  }

  async open(image: string, digest: string, registry: RegistryClient | undefined): Promise<Readable> {
    const url = this.blobUrl(image, digest, registry);
    let response = await this.fetcher(url, { redirect: 'follow' });

    if (response.status === 401 && url.startsWith('https://')) {
      const tokenUrl = bearerTokenUrl(response.headers.get('www-authenticate'));

      if (tokenUrl) {
        const token = (await (await this.fetcher(tokenUrl)).json()) as { token?: string; access_token?: string };
        const bearer = token.token ?? token.access_token;

        if (bearer)
          response = await this.fetcher(url, { redirect: 'follow', headers: { authorization: `Bearer ${bearer}` } });
      }
    }

    if (!response.ok || !response.body)
      throw new LayerUnpackError(`fetching layer ${digest} of ${image} failed (HTTP ${response.status})`);

    return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  }
}

/** The agent binary for child processes: the SEA itself, or node + the main script in development. */
export function agentInvocation(): string[] {
  return isSea() ? [process.execPath] : [process.execPath, process.argv[1]];
}

/** Unpacks in `loadweaver-agent unpack-layer` under `unshare` (own mount + PID namespace, read-only host). */
export class ConfinedLayerUnpacker implements LayerUnpacker {
  constructor(private readonly agent: string[] = agentInvocation()) {}

  unpack(
    blob: Readable,
    options: { staging: string; mediaType: string; size: number; maxBytes: number },
  ): Promise<UnpackResult> {
    const [command, args] = unpackCommand(this.agent, options);

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' },
      });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d: Buffer) => (stdout = (stdout + d.toString()).slice(-65_536)));
      child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4096)));
      blob.on('error', (error) => {
        child.kill('SIGKILL');
        reject(error);
      });
      child.stdin.on('error', () => undefined);
      blob.pipe(child.stdin);
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new LayerUnpackError(`unpacking failed (exit ${code}): ${stderr.trim()}`));

        try {
          resolve(JSON.parse(stdout.trim().split('\n').pop() ?? '') as UnpackResult);
        } catch {
          reject(new LayerUnpackError('unpacking returned no result'));
        }
      });
    });
  }
}

/** Optional overrides (tests, labs): layout, blob source, unpacker. */
export const ROOTFS_CACHE_OPTIONS = Symbol('ROOTFS_CACHE_OPTIONS');

export interface RootfsCacheOptions {
  config?: VmrootConfig;
  blobs?: BlobSource;
  unpacker?: LayerUnpacker;
}

const GC_INTERVAL_MS = 3_600_000;

@Injectable()
export class RootfsCache implements OnModuleDestroy {
  private readonly logger = new Logger(RootfsCache.name);
  private readonly config: VmrootConfig;
  private readonly unpacking = new Map<string, Promise<void>>();
  private readonly blobs: BlobSource;
  private readonly unpacker: LayerUnpacker;
  private gcTimer: NodeJS.Timeout | null = null;
  /** Layers the last desired state uses (kept by GC even when no replica is mounted). */
  private desired = new Set<string>();
  private preparing: Promise<void> | null = null;

  constructor(
    private readonly commands: CommandRunner,
    @Optional() @Inject(ROOTFS_CACHE_OPTIONS) options?: RootfsCacheOptions,
  ) {
    this.config = options?.config ?? vmrootConfig();
    this.blobs = options?.blobs ?? new RegistryBlobSource();
    this.unpacker = options?.unpacker ?? new ConfinedLayerUnpacker();
  }

  onModuleDestroy(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);

    this.gcTimer = null;
  }

  get paths(): VmrootConfig {
    return this.config;
  }

  /** Creates the layout (root-only) and removes leftovers of interrupted unpacks (once per process). */
  private prepare(): Promise<void> {
    this.preparing ??= this.prepareNow().catch((error: unknown) => {
      this.preparing = null;
      throw error;
    });

    return this.preparing;
  }

  private async prepareNow(): Promise<void> {
    for (const dir of [
      this.config.root,
      join(this.config.root, 'layers', 'sha256'),
      join(this.config.root, 'replicas'),
    ])
      await mkdir(dir, { recursive: true, mode: 0o700 });

    await rm(join(this.config.root, 'staging'), { recursive: true, force: true });
    await mkdir(join(this.config.root, 'staging'), { mode: 0o700 });
    await mkdir(this.config.mountRoot, { recursive: true, mode: 0o700 });
    this.gcTimer ??= setInterval(() => void this.gc().catch(() => undefined), GC_INTERVAL_MS);
    this.gcTimer.unref?.();
  }

  /** Whether the node can run the cache (writable root, the tools of the confined unpack): for capabilities. */
  async available(): Promise<{ unpackCache: boolean; thinPool: boolean }> {
    const unpackCache =
      (await this.prepare().then(
        () => true,
        () => false,
      )) &&
      (await this.commands.available('unshare', ['--version'])) &&
      (await this.commands.available('setfattr', ['--version'])) &&
      (await this.commands.available('mkfs.ext4', ['-V']));

    return { unpackCache, thinPool: await this.thinPool() };
  }

  private async thinPool(): Promise<boolean> {
    const storage = storageConfig();
    const report = await this.commands
      .json<{
        report: { lv: { lv_name: string }[] }[];
      }>('lvs', ['--reportformat', 'json', '-o', 'lv_name', storage.volumeGroup])
      .catch(() => null);

    return !!report?.report[0]?.lv.some((l) => l.lv_name === storage.thinPool);
  }

  /** Ensures every layer is unpacked (one unpack per diffID at a time, in-process and across processes). */
  async ensureLayers(
    image: string,
    layers: readonly MicrovmLayer[],
    registry: RegistryClient | undefined,
  ): Promise<void> {
    await this.prepare();

    for (const layer of layers) {
      layerCompression(layer.mediaType);

      const hex = hexOf(layer.diffId);
      let pending = this.unpacking.get(hex);

      if (!pending) {
        pending = this.ensureLayer(image, layer, registry).finally(() => this.unpacking.delete(hex));
        this.unpacking.set(hex, pending);
      }

      await pending;
    }
  }

  private async marker(diffId: string): Promise<LayerMarker | null> {
    try {
      const marker = JSON.parse(await readFile(layerMarker(this.config, diffId), 'utf8')) as LayerMarker;

      return marker.diffId === diffId && (await stat(layerDir(this.config, diffId))).isDirectory() ? marker : null;
    } catch {
      return null;
    }
  }

  private async writeMarker(diffId: string, marker: LayerMarker): Promise<void> {
    const file = layerMarker(this.config, diffId);

    await writeFile(`${file}.tmp`, JSON.stringify(marker), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }

  private async ensureLayer(image: string, layer: MicrovmLayer, registry: RegistryClient | undefined): Promise<void> {
    const existing = await this.marker(layer.diffId);

    if (existing) {
      await this.writeMarker(layer.diffId, { ...existing, usedAt: new Date().toISOString() });

      return;
    }

    const hex = hexOf(layer.diffId);
    const lock = join(this.config.root, 'staging', `${hex}.lock`);
    const handle = await open(lock, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') throw new LayerUnpackError(`layer ${layer.diffId} is being unpacked elsewhere`);

        throw error;
      },
    );
    const staging = join(this.config.root, 'staging', `${hex}-${randomBytes(4).toString('hex')}`);

    try {
      await handle.write(String(process.pid));
      await this.ensureSpace(layer.size);
      await mkdir(staging, { mode: 0o755 });

      const started = Date.now();
      const blob = await this.blobs.open(image, layer.digest, registry);
      const result = await this.unpacker.unpack(blob, {
        staging,
        mediaType: layer.mediaType,
        size: layer.size,
        maxBytes: this.config.layerMaxBytes,
      });

      if (result.digest !== layer.digest)
        throw new LayerUnpackError(`layer ${layer.digest}: the blob's digest is ${result.digest}`);

      if (result.diffId !== layer.diffId)
        throw new LayerUnpackError(
          `layer ${layer.digest}: the uncompressed digest is ${result.diffId}, not ${layer.diffId}`,
        );

      // A directory without marker is a crashed publish: replaced.
      await rm(layerDir(this.config, layer.diffId), { recursive: true, force: true });
      await rename(staging, layerDir(this.config, layer.diffId));

      const now = new Date().toISOString();

      await this.writeMarker(layer.diffId, {
        digest: layer.digest,
        diffId: layer.diffId,
        bytes: result.bytes,
        unpackedAt: now,
        usedAt: now,
      });
      this.logger.log(
        `Unpacked layer ${layer.diffId.slice(0, 19)} (${Math.round(result.bytes / 1024 ** 2)} MiB, ${result.entries} entries${result.droppedDevices ? `, ${result.droppedDevices} device nodes dropped` : ''}) in ${Date.now() - started} ms`,
      );
    } finally {
      await handle.close();
      await rm(lock, { force: true });
      await rm(staging, { recursive: true, force: true });
    }
  }

  /** Room for the unpacked layer: collects first, refuses when the file system stays too full. */
  private async ensureSpace(declaredSize: number): Promise<void> {
    const need = declaredSize * 4 + GIB;
    const free = async () => {
      const fs = await statfs(this.config.root);

      return Number(fs.bavail) * Number(fs.bsize);
    };

    if ((await free()) >= need) return;

    await this.gc();

    if ((await free()) < need) throw new LayerUnpackError('not enough disk space to unpack the microVM image layer');
  }

  /** The cap: configured, else 15 % of the file system. */
  async capBytes(): Promise<number> {
    if (this.config.cacheMaxBytes) return this.config.cacheMaxBytes;

    const fs = await statfs(this.config.root);

    return Math.floor(Number(fs.blocks) * Number(fs.bsize) * DEFAULT_CACHE_SHARE);
  }

  /** Layers in the cache with their size and last use. */
  async layers(): Promise<{ hex: string; bytes: number; usedAt: number }[]> {
    const dir = join(this.config.root, 'layers', 'sha256');
    const names = await readdir(dir).catch(() => [] as string[]);
    const layers: { hex: string; bytes: number; usedAt: number }[] = [];

    for (const name of names.filter((n) => /^[0-9a-f]{64}\.json$/.test(n))) {
      const marker = await this.marker(`sha256:${name.slice(0, 64)}`);

      if (marker) layers.push({ hex: name.slice(0, 64), bytes: marker.bytes, usedAt: Date.parse(marker.usedAt) || 0 });
    }

    return layers;
  }

  /** Metrics: cache bytes and layer count. */
  async usage(): Promise<{ bytes: number; layers: number }> {
    const layers = await this.layers();

    return { bytes: layers.reduce((sum, l) => sum + l.bytes, 0), layers: layers.length };
  }

  /** The layers the desired state uses (after every desired state); GC never removes them. */
  setDesired(layers: readonly Pick<MicrovmLayer, 'diffId'>[]): void {
    this.desired = new Set(layers.flatMap((l) => (SHA256.test(l.diffId) ? [hexOf(l.diffId)] : [])));
  }

  /** LRU over layers no mounted replica and no desired workload uses, until the cache fits its cap. */
  async gc(): Promise<string[]> {
    const mounted = mountedLayers(await readFile('/proc/self/mountinfo', 'utf8').catch(() => ''), this.config.root);
    const referenced = new Set([...mounted, ...this.desired]);
    const victims = layersToCollect(await this.layers(), referenced, await this.capBytes());

    for (const hex of victims) {
      // Marker first: a half-removed layer is never taken for complete.
      await rm(layerMarker(this.config, `sha256:${hex}`), { force: true });
      await rm(layerDir(this.config, `sha256:${hex}`), { recursive: true, force: true });
    }

    if (victims.length) this.logger.log(`Removed ${victims.length} unused microVM image layers from the cache`);

    return victims;
  }

  private async mounted(path: string): Promise<boolean> {
    const mountinfo = await readFile('/proc/self/mountinfo', 'utf8').catch(() => '');

    return parseMountinfo(mountinfo).some((m) => m.mountPoint === path);
  }

  /**
   * Mounts a replica's guest root and returns the merged directory: the writable layer (a thin LV of `rootfsBytes`
   * in the node's volume pool, ext4 with discard — a hard quota; else a sparse ext4 image on a loop device), then the
   * overlay of the image layers, both `nosuid,nodev,noexec`. Idempotent; a kept writable layer is reused (container
   * semantics: a restart keeps it, {@link release} on delete / recreate discards it).
   */
  async mountReplica(workloadId: string, layers: readonly MicrovmLayer[], rootfsBytes: number): Promise<string> {
    await this.prepare();

    const paths = replicaPaths(this.config, workloadId);

    if (await this.mounted(paths.merged)) return paths.merged;

    await mkdir(paths.rw, { recursive: true, mode: 0o700 });

    if (!(await this.mounted(paths.rw))) await this.mountWritable(paths, rootfsBytes);

    await mkdir(paths.upper, { recursive: true, mode: 0o755 });
    await mkdir(paths.work, { recursive: true, mode: 0o700 });
    await mkdir(paths.merged, { recursive: true, mode: 0o755 });
    await this.commands.run('mount', [
      '-t',
      'overlay',
      'overlay',
      '-o',
      overlayMountOptions(this.config, layers, paths),
      paths.merged,
    ]);

    // Mark the layers used (LRU).
    for (const layer of layers) {
      const marker = await this.marker(layer.diffId);

      if (marker) await this.writeMarker(layer.diffId, { ...marker, usedAt: new Date().toISOString() });
    }

    return paths.merged;
  }

  private async mountWritable(paths: ReplicaPaths, rootfsBytes: number): Promise<void> {
    const storage = storageConfig();
    const mountOptions = 'nosuid,nodev,noexec,discard';

    if (await this.thinPool()) {
      const device = `/dev/${storage.volumeGroup}/${paths.lv}`;
      const report = await this.commands.json<{ report: { lv: { lv_name: string }[] }[] }>('lvs', [
        '--reportformat',
        'json',
        '-o',
        'lv_name',
        storage.volumeGroup,
      ]);

      if (!report.report[0]?.lv.some((l) => l.lv_name === paths.lv)) {
        await this.commands.run('lvcreate', [
          '-y',
          '--config',
          VolumeManager.THIN_CHECK_CONFIG,
          '-V',
          `${Math.ceil(rootfsBytes / 512) * 512}b`,
          '-T',
          `${storage.volumeGroup}/${storage.thinPool}`,
          '-n',
          paths.lv,
        ]);
        await this.commands.run('mkfs.ext4', ['-q', '-F', '-E', 'nodiscard,root_owner=0:0', device], {
          timeoutMs: 600_000,
        });
      } else {
        await this.commands.run('lvchange', [
          '-ay',
          '--config',
          VolumeManager.THIN_CHECK_CONFIG,
          `${storage.volumeGroup}/${paths.lv}`,
        ]);
      }

      await this.commands.run('mount', ['-t', 'ext4', '-o', mountOptions, device, paths.rw]);

      return;
    }

    const exists = await stat(paths.image).catch(() => null);

    if (!exists) {
      // Sparse: blocks are only allocated as the guest writes (plan warning "no thin pool").
      const file = await open(paths.image, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);

      try {
        await file.truncate(rootfsBytes);
      } finally {
        await file.close();
      }

      await this.commands.run('mkfs.ext4', ['-q', '-F', '-E', 'nodiscard,root_owner=0:0', paths.image], {
        timeoutMs: 600_000,
      });
    }

    await this.commands.run('mount', ['-t', 'ext4', '-o', `loop,${mountOptions}`, paths.image, paths.rw]);
  }

  /** Unmounts a replica's guest root and discards its writable layer (replica deleted or recreated). */
  async release(workloadId: string): Promise<void> {
    const paths = replicaPaths(this.config, workloadId);

    for (const mountPoint of [paths.merged, paths.rw])
      if (await this.mounted(mountPoint))
        await this.commands.run('umount', [mountPoint]).catch(() => this.commands.run('umount', ['-l', mountPoint]));

    if (await this.thinPool()) {
      const storage = storageConfig();

      await this.commands.run('lvremove', ['-y', `${storage.volumeGroup}/${paths.lv}`], { okExitCodes: [5] });
    }

    await rm(paths.dir, { recursive: true, force: true });
    await rm(join(this.config.mountRoot, paths.key), { recursive: true, force: true });
  }
}
