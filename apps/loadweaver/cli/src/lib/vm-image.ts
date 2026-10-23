import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';

import {
  containerDiskFormat,
  detectVmDiskFormat,
  OCI_IMAGE_MANIFEST_MEDIA_TYPE,
  PRIVATE_REGISTRY_HOST,
  qcow2HasBackingFile,
  qcow2VirtualSize,
  VM_IMAGE_ARCHES,
  VM_IMAGE_CONFIG_MEDIA_TYPE,
  VM_IMAGE_DISK_MEDIA_TYPES,
  VM_FIRMWARES,
  vmImageConfigSchema,
  vmImageLayerTitle,
  vmImageManifestDocument,
  type VmFirmware,
  type VmImageArch,
  type VmImageConfig,
  type VmImageFormat,
} from '@forepath/loadweaver/shared/util-model';
import { readTar } from '@forepath/loadweaver/shared/util-release';

import type { Api } from './api';

/**
 * `loadweaver vm-image push` (3.35): pushes a local disk image — qcow2, raw (stored zstd-compressed), or a KubeVirt
 * containerDisk archive (`/disk/*.qcow2|*.img`, also gzip-compressed) — into the project's namespace of the built-in
 * registry as an OCI VM image artifact (config + one disk layer + manifest, media types of util-model `vm-image.ts`).
 * The registry is reached through the control plane's `/v2` with a short registry token for the repository
 * (`GET /api/registry/token`, the CLI's login; personal access tokens need the `registry:push` scope).
 */

type Out = (line: string) => void;

const REPOSITORY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const PROJECT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const HEADER_BYTES = 64 * 1024;
/** Upload chunk (PATCH): bounded memory, progress per chunk. */
export const UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;
/** Registry tokens of users live 300 s: a new one is fetched well before. */
const TOKEN_REFRESH_MS = 200_000;
const REGISTRY_SERVICE = 'loadweaver-registry';

export interface VmImageTarget {
  /** Where `/v2` is served: the control plane (default) or an explicit registry host. */
  base: string;
  project: string;
  /** `<project>/<repository>` in the registry. */
  repository: string;
  tag: string;
}

/**
 * `<project>/<repository>:<tag>`, `registry.lw/<project>/<repository>:<tag>` or `<host>/<project>/<repository>:<tag>`
 * (the control plane's public host; any other host is addressed over HTTPS directly).
 */
export function parseVmImageTarget(reference: string, controlPlane: string): VmImageTarget {
  let rest = reference.trim();
  let base = controlPlane.replace(/\/+$/, '');
  const first = rest.split('/')[0];

  if (rest.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost')) {
    rest = rest.slice(first.length + 1);

    if (first !== PRIVATE_REGISTRY_HOST && first !== new URL(base).host) base = `https://${first}`;
  }

  const colon = rest.lastIndexOf(':');
  const path = colon > 0 ? rest.slice(0, colon) : rest;
  const tag = colon > 0 ? rest.slice(colon + 1) : 'latest';
  const slash = path.indexOf('/');
  const project = slash > 0 ? path.slice(0, slash) : '';
  const name = slash > 0 ? path.slice(slash + 1) : '';

  if (!PROJECT.test(project) || !REPOSITORY.test(name) || path.length > 255 || !TAG.test(tag))
    throw new Error(`invalid image reference ${reference}: expected [registry.lw/]<project>/<repository>[:<tag>]`);

  return { base, project, repository: path, tag };
}

export interface DiskInfo {
  format: VmImageFormat;
  virtualSize: number;
}

export type QemuImgInfo = (
  path: string,
) => Promise<{ format?: string; 'virtual-size'?: number; 'backing-filename'?: string } | null>;

/** `qemu-img info --output=json` when qemu-img is installed; null otherwise (the header is parsed instead). */
export const qemuImgInfo: QemuImgInfo = (path) =>
  new Promise((resolve, reject) => {
    execFile('qemu-img', ['info', '--output=json', path], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return resolve(null);

      if (error) return reject(new Error(`qemu-img info failed: ${error.message}`));

      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('qemu-img info: unreadable output'));
      }
    });
  });

async function readHeader(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');

  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);

    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Format and virtual size of a qcow2 / raw disk file; qcow2 with a backing file and other formats are refused. */
export async function inspectDisk(
  path: string,
  info: QemuImgInfo = qemuImgInfo,
  forced?: VmImageFormat,
): Promise<DiskInfo> {
  const header = await readHeader(path);
  const detected = detectVmDiskFormat(header) === 'qcow2' ? 'qcow2' : 'raw';
  const qemu = await info(path);

  if (qemu) {
    const format = qemu.format === 'qcow2' || qemu.format === 'raw' ? qemu.format : null;

    if (!format)
      throw new Error(`${path} is ${qemu.format ?? 'unknown'}: convert it first (qemu-img convert -O qcow2 …)`);

    if (qemu['backing-filename']) throw new Error(`${path} has a backing file; flatten it first (qemu-img convert)`);

    if (forced && forced !== format) throw new Error(`${path} is ${format}, not ${forced}`);

    if (!qemu['virtual-size'] || qemu['virtual-size'] <= 0)
      throw new Error(`${path}: qemu-img reports no virtual size`);

    return { format, virtualSize: qemu['virtual-size'] };
  }

  if (forced && forced !== detected) throw new Error(`${path} is ${detected}, not ${forced}`);

  if (detected === 'qcow2') {
    if (qcow2HasBackingFile(header)) throw new Error(`${path} has a backing file; flatten it first (qemu-img convert)`);

    const virtualSize = qcow2VirtualSize(header);

    if (!virtualSize) throw new Error(`${path}: invalid qcow2 header`);

    return { format: 'qcow2', virtualSize };
  }

  const size = (await stat(path)).size;

  if (size === 0) throw new Error(`${path} is empty`);

  return { format: 'raw', virtualSize: size };
}

/** Streams a file through sha256 (and, for raw disks, zstd into `compressTo`): digest and stored size. */
async function digestOf(
  path: string,
  progress: (done: number) => void,
  compressTo?: string,
): Promise<{ digest: string; size: number }> {
  const hash = createHash('sha256');
  let size = 0;
  let read = 0;

  if (!compressTo) {
    for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
      hash.update(chunk);
      size += chunk.length;
      progress(size);
    }

    return { digest: `sha256:${hash.digest('hex')}`, size };
  }

  const createZstd = (zlib as unknown as { createZstdCompress?: () => Transform }).createZstdCompress;

  if (!createZstd) throw new Error('raw images need zstd support (Node.js 22.15 or newer)');

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  const source = createReadStream(path).on('data', (c) => progress((read += c.length)));

  await pipeline(source, createZstd(), counter, createWriteStream(compressTo));

  return { digest: `sha256:${hash.digest('hex')}`, size };
}

/** Extracts the disk of a KubeVirt containerDisk archive (optionally gzip-compressed) into `dir`. */
async function extractContainerDisk(
  path: string,
  gzip: boolean,
  dir: string,
): Promise<{ path: string; entry: string }> {
  const source: Readable = gzip ? createReadStream(path).pipe(zlib.createGunzip()) : createReadStream(path);

  for await (const entry of readTar(source)) {
    if (entry.type !== 'file' || !containerDiskFormat(entry.name)) continue;

    const target = join(dir, 'disk');

    await pipeline(entry.body as AsyncIterable<Buffer>, createWriteStream(target));
    source.destroy();

    return { path: target, entry: entry.name };
  }

  throw new Error(`${path} is a tar archive without a /disk/*.qcow2 or /disk/*.img entry (no KubeVirt containerDisk)`);
}

/** Gunzips a compressed disk into `dir`. */
async function gunzip(path: string, dir: string): Promise<string> {
  const target = join(dir, 'disk.gunzipped');

  await pipeline(createReadStream(path), zlib.createGunzip(), createWriteStream(target));

  return target;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** Calls the registry (`/v2`) through the control plane with a registry token that is renewed before it expires. */
class RegistryClient {
  private token: { value: string; at: number } | null = null;

  constructor(
    private readonly api: Api,
    private readonly target: VmImageTarget,
  ) {}

  /** A push + pull token for the repository; refused when the login may not push there. */
  private async bearer(): Promise<string> {
    if (this.token && Date.now() - this.token.at < TOKEN_REFRESH_MS) return this.token.value;

    const scope = `repository:${this.target.repository}:pull,push`;
    const { token } = await this.api.request<{ token: string }>(
      'GET',
      `/registry/token?service=${REGISTRY_SERVICE}&scope=${encodeURIComponent(scope)}`,
    );

    if (!grantsPush(token, this.target.repository))
      throw new Error(
        `this login may not push to ${PRIVATE_REGISTRY_HOST}/${this.target.repository} (operator rights in project ${this.target.project}; personal access tokens need the registry:push scope)`,
      );

    this.token = { value: token, at: Date.now() };

    return token;
  }

  async call(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: Buffer } = {},
  ): Promise<Response> {
    const url = path.startsWith('/')
      ? `${this.target.base}${path}`
      : `${this.target.base}/v2/${this.target.repository}/${path}`;

    return await fetch(url, {
      method,
      headers: { authorization: `Bearer ${await this.bearer()}`, ...init.headers },
      ...(init.body ? { body: init.body as unknown as BodyInit } : {}),
      redirect: 'error',
    });
  }

  /** Path + query of an upload location (absolute locations name the registry's own host: only the path is used). */
  static location(res: Response): string {
    const location = res.headers.get('location');

    if (!location) throw new Error('registry: upload without a location');

    const url = new URL(location, 'http://registry.invalid');

    return `${url.pathname}${url.search}`;
  }
}

/** Whether a registry token's `access` claim allows pushing to `repository` (a cheap, early, readable refusal). */
export function grantsPush(token: string, repository: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      access?: { type?: string; name?: string; actions?: string[] }[];
    };

    return (payload.access ?? []).some(
      (a) => a.type === 'repository' && a.name === repository && (a.actions ?? []).includes('push'),
    );
  } catch {
    return false;
  }
}

async function failure(res: Response, what: string): Promise<Error> {
  const text = await res.text().catch(() => '');

  return new Error(`registry refused ${what} (HTTP ${res.status}): ${text.slice(0, 300)}`);
}

/** Uploads one blob: skipped when present, else chunked (POST, PATCH per chunk, PUT with the digest). */
async function uploadBlob(
  registry: RegistryClient,
  digest: string,
  size: number,
  read: (start: number, length: number) => Promise<Buffer>,
  progress: (done: number) => void,
): Promise<boolean> {
  const head = await registry.call('HEAD', `blobs/${digest}`);

  if (head.status === 200) return false;

  const started = await registry.call('POST', 'blobs/uploads/');

  if (started.status !== 202) throw await failure(started, `the upload of ${digest}`);

  let location = RegistryClient.location(started);

  for (let offset = 0; offset < size; ) {
    const chunk = await read(offset, Math.min(UPLOAD_CHUNK_BYTES, size - offset));
    const patched = await registry.call('PATCH', location, {
      body: chunk,
      headers: {
        'content-type': 'application/octet-stream',
        'content-range': `${offset}-${offset + chunk.length - 1}`,
      },
    });

    if (patched.status !== 202) throw await failure(patched, `chunk ${offset} of ${digest}`);

    location = RegistryClient.location(patched);
    offset += chunk.length;
    progress(offset);
  }

  const separator = location.includes('?') ? '&' : '?';
  const done = await registry.call('PUT', `${location}${separator}digest=${encodeURIComponent(digest)}`);

  if (done.status !== 201) throw await failure(done, `blob ${digest}`);

  return true;
}

async function fileReader(
  path: string,
): Promise<{ read: (start: number, length: number) => Promise<Buffer>; close: () => Promise<void> }> {
  const handle = await open(path, 'r');

  return {
    read: async (start, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);

      if (bytesRead !== length) throw new Error(`${path} changed while pushing`);

      return buffer;
    },
    close: () => handle.close(),
  };
}

export interface VmImagePushArgs {
  file: string;
  reference: string;
  arch?: string;
  firmware?: string;
  guestAgent?: boolean;
  format?: string;
}

/**
 * `vm-image push <file> [registry.lw/]<project>/<repository>[:<tag>] [--arch amd64|arm64] [--firmware uefi[,bios]]
 * [--guest-agent] [--format qcow2|raw]`: prints progress and the pushed reference with its digest.
 */
export async function pushVmImage(
  api: Api,
  args: VmImagePushArgs,
  out: Out,
  info: QemuImgInfo = qemuImgInfo,
): Promise<string> {
  const target = parseVmImageTarget(args.reference, api.base);
  const arch = (args.arch ?? 'amd64') as VmImageArch;
  const firmware = (args.firmware ?? 'uefi').split(',').map((f) => f.trim()) as VmFirmware[];
  const forced = args.format as VmImageFormat | undefined;

  if (!VM_IMAGE_ARCHES.includes(arch)) throw new Error(`--arch must be one of ${VM_IMAGE_ARCHES.join(', ')}`);

  if (firmware.some((f) => !VM_FIRMWARES.includes(f))) throw new Error(`--firmware takes ${VM_FIRMWARES.join(', ')}`);

  if (forced && forced !== 'qcow2' && forced !== 'raw') throw new Error('--format must be qcow2 or raw');

  const work = await mkdtemp(join(tmpdir(), 'lw-vm-image-'));
  const progressLine = (label: string, total: number) => {
    let last = -1;

    return (done: number) => {
      const percent = total > 0 ? Math.floor((done / total) * 100) : 100;

      // At most one line per 10 %, plus the end.
      if (percent === 100 || Math.floor(percent / 10) > Math.floor(last / 10)) {
        if (percent === last) return;

        last = percent;
        out(`  ${label} ${formatBytes(done)} / ${formatBytes(total)} (${percent}%)`);
      }
    };
  };

  try {
    let disk = args.file;
    let kind = detectVmDiskFormat(await readHeader(disk));

    if (kind === 'zstd') throw new Error(`${args.file} is zstd-compressed: decompress it first`);

    if (kind === 'gzip') {
      const head = await new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        const gz = zlib.createGunzip();
        const stream = createReadStream(disk, { end: HEADER_BYTES - 1 });

        gz.on('data', (c: Buffer) => chunks.push(c));
        gz.on('error', () => resolve(Buffer.concat(chunks)));
        gz.on('end', () => resolve(Buffer.concat(chunks)));
        stream.pipe(gz);
      });

      if (detectVmDiskFormat(head) === 'tar') {
        const extracted = await extractContainerDisk(disk, true, work);

        out(`containerDisk: ${extracted.entry}`);
        disk = extracted.path;
      } else {
        out(`Decompressing ${args.file}…`);
        disk = await gunzip(disk, work);
      }

      kind = detectVmDiskFormat(await readHeader(disk));
    } else if (kind === 'tar') {
      const extracted = await extractContainerDisk(disk, false, work);

      out(`containerDisk: ${extracted.entry}`);
      disk = extracted.path;
    }

    const { format, virtualSize } = await inspectDisk(disk, info, forced);
    const config: VmImageConfig = vmImageConfigSchema.parse({
      arch,
      format,
      virtualSize,
      firmware: [...new Set(firmware)],
      ...(args.guestAgent ? { guestAgent: true } : {}),
    });
    const fileSize = (await stat(disk)).size;

    out(`${format} disk, virtual size ${formatBytes(virtualSize)}, ${arch}, ${config.firmware.join(' / ')}`);

    // The layer: qcow2 as it is, raw compressed with zstd (sparse raw images shrink a lot).
    const layerPath = format === 'raw' ? join(work, 'disk.raw.zst') : disk;
    const layer = await digestOf(
      disk,
      progressLine(format === 'raw' ? 'compressing' : 'hashing', fileSize),
      format === 'raw' ? layerPath : undefined,
    );
    const configData = Buffer.from(JSON.stringify(config), 'utf8');
    const configDigest = `sha256:${createHash('sha256').update(configData).digest('hex')}`;
    const registry = new RegistryClient(api, target);
    const reader = await fileReader(layerPath);

    try {
      const uploaded = await uploadBlob(
        registry,
        layer.digest,
        layer.size,
        reader.read,
        progressLine('uploading', layer.size),
      );

      if (!uploaded) out(`  disk layer ${layer.digest} already in the registry`);
    } finally {
      await reader.close();
    }

    await uploadBlob(
      registry,
      configDigest,
      configData.length,
      async (s, l) => configData.subarray(s, s + l),
      () => undefined,
    );

    const manifest = Buffer.from(
      JSON.stringify(
        vmImageManifestDocument(
          { mediaType: VM_IMAGE_CONFIG_MEDIA_TYPE, digest: configDigest, size: configData.length },
          {
            mediaType: VM_IMAGE_DISK_MEDIA_TYPES[format],
            digest: layer.digest,
            size: layer.size,
            annotations: { 'org.opencontainers.image.title': vmImageLayerTitle(format) },
          },
        ),
      ),
      'utf8',
    );
    const digest = `sha256:${createHash('sha256').update(manifest).digest('hex')}`;
    const put = await registry.call('PUT', `manifests/${encodeURIComponent(target.tag)}`, {
      body: manifest,
      headers: { 'content-type': OCI_IMAGE_MANIFEST_MEDIA_TYPE },
    });

    if (put.status !== 201) throw await failure(put, `manifest ${target.tag}`);

    const reference = `${PRIVATE_REGISTRY_HOST}/${target.repository}:${target.tag}@${digest}`;

    out(`Pushed ${reference}`);

    return reference;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
