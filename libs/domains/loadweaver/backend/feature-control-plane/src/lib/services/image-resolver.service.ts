import type { Transform } from 'node:stream';
import * as zlib from 'node:zlib';

import { parseImageReference, registryApiHost } from '@forepath/loadweaver/shared/util-compose';
import {
  containerDiskFormat,
  detectVmDiskFormat,
  qcow2VirtualSize,
  VM_IMAGE_ARTIFACT_TYPE,
  VM_IMAGE_CONFIG_MEDIA_TYPE,
  vmImageConfigSchema,
  vmImageFormatOfMediaType,
} from '@forepath/loadweaver/shared/util-model';
import { validateWebhookUrlWithDnsOrThrow } from '@forepath/shared/backend/util-webhook';
import { Injectable } from '@nestjs/common';

import type { OciDescriptor, RepositoryReader } from '../images/image-signature';
import type { ImageInspection, ImageLayer } from '../utils/microvm-planning.utils';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');
const REQUEST_TIMEOUT_MS = 10_000;

function parseBearerChallenge(header: string | null): { realm: string; service?: string; scope?: string } | null {
  if (!header || !/^Bearer\s/i.test(header)) return null;

  const params = Object.fromEntries([...header.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));

  return params['realm'] ? { realm: params['realm'], service: params['service'], scope: params['scope'] } : null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Pins images to digests at plan time (3.22), so an apply deploys exactly what was reviewed even if a tag moves.
 * Registry and token URLs come from user input; both must be HTTPS and resolve to public addresses (SSRF).
 */
@Injectable()
export class ImageResolverService {
  async resolve(
    reference: string,
    fetchImpl: FetchLike = fetch,
    validateUrl: (url: string) => Promise<unknown> = validateWebhookUrlWithDnsOrThrow,
  ): Promise<string> {
    const ref = parseImageReference(reference);

    if (!ref) throw new Error(`invalid image reference ${reference}`);

    if (ref.digest) return reference;

    const registry = registryApiHost(ref.host);
    const manifestUrl = `https://${registry}/v2/${ref.repository}/manifests/${ref.tag ?? 'latest'}`;

    await validateUrl(manifestUrl);

    const request = (headers: Record<string, string>) =>
      fetchImpl(manifestUrl, {
        method: 'HEAD',
        headers: { Accept: MANIFEST_ACCEPT, ...headers },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    let res = await request({});

    if (res.status === 401) {
      const challenge = parseBearerChallenge(res.headers.get('www-authenticate'));

      if (!challenge) throw new Error(`registry ${registry} requires unsupported authentication`);

      const tokenUrl = new URL(challenge.realm);

      if (challenge.service) tokenUrl.searchParams.set('service', challenge.service);

      tokenUrl.searchParams.set('scope', challenge.scope ?? `repository:${ref.repository}:pull`);
      await validateUrl(tokenUrl.toString());

      const tokenRes = await fetchImpl(tokenUrl.toString(), {
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!tokenRes.ok) throw new Error(`registry ${registry} denied anonymous access`);

      const body = (await tokenRes.json()) as { token?: string; access_token?: string };
      const token = body.token ?? body.access_token;

      if (!token) throw new Error(`registry ${registry} returned no token`);

      res = await request({ Authorization: `Bearer ${token}` });
    }

    if (!res.ok) throw new Error(`image ${reference} not found (HTTP ${res.status})`);

    const digest = res.headers.get('docker-content-digest');

    if (!digest || !DIGEST.test(digest)) throw new Error(`registry ${registry} returned no digest for ${reference}`);

    return `${ref.name}@${digest}`;
  }

  /**
   * Pins an image of the built-in private registry (3.22) through the members' registry instances over the overlay.
   * The addresses come from the control plane's own node records, so no SSRF checks apply here.
   */
  async resolveInCluster(
    reference: string,
    endpoints: string[],
    token: string,
    fetchImpl: FetchLike = fetch,
  ): Promise<string> {
    const ref = parseImageReference(reference);

    if (!ref) throw new Error(`invalid image reference ${reference}`);

    if (ref.digest) return reference;

    let lastError = 'no registry member reachable';

    for (const endpoint of endpoints) {
      let res: Response;

      try {
        res = await fetchImpl(`http://${endpoint}/v2/${ref.repository}/manifests/${ref.tag ?? 'latest'}`, {
          method: 'HEAD',
          headers: { Accept: MANIFEST_ACCEPT, Authorization: `Bearer ${token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        continue;
      }

      if (res.status === 404) throw new Error(`image ${reference} not found in the built-in registry; push it first`);

      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }

      const digest = res.headers.get('docker-content-digest');

      if (!digest || !DIGEST.test(digest)) throw new Error(`the built-in registry returned no digest for ${reference}`);

      return `${ref.name}@${digest}`;
    }

    throw new Error(`image ${reference} not resolvable: ${lastError}`);
  }

  /**
   * Reads manifests and blobs of a public repository (signatures, 3.22) with the same anonymous token flow and SSRF
   * checks as pinning; blob redirects (CDNs) are followed by hand, each target checked, without the token.
   */
  publicReader(
    reference: string,
    fetchImpl: FetchLike = fetch,
    validateUrl: (url: string) => Promise<unknown> = validateWebhookUrlWithDnsOrThrow,
  ): RepositoryReader {
    const ref = parseImageReference(reference);

    if (!ref) throw new Error(`invalid image reference ${reference}`);

    const registry = registryApiHost(ref.host);
    let token: string | null = null;
    const get = async (path: string, accept?: string): Promise<Response> => {
      const url = `https://${registry}/v2/${ref.repository}/${path}`;

      await validateUrl(url);

      const request = () =>
        fetchImpl(url, {
          headers: { ...(accept ? { Accept: accept } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      let res = await request();

      if (res.status === 401 && !token) {
        const challenge = parseBearerChallenge(res.headers.get('www-authenticate'));

        if (!challenge) throw new Error(`registry ${registry} requires unsupported authentication`);

        const tokenUrl = new URL(challenge.realm);

        if (challenge.service) tokenUrl.searchParams.set('service', challenge.service);

        tokenUrl.searchParams.set('scope', `repository:${ref.repository}:pull`);
        await validateUrl(tokenUrl.toString());

        const tokenRes = await fetchImpl(tokenUrl.toString(), {
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const body = tokenRes.ok ? ((await tokenRes.json()) as { token?: string; access_token?: string }) : {};

        token = body.token ?? body.access_token ?? null;

        if (!token) throw new Error(`registry ${registry} denied anonymous access`);

        res = await request();
      }

      for (let hops = 0; res.status >= 300 && res.status < 400 && hops < 3; hops++) {
        const location = res.headers.get('location');

        if (!location) break;

        const target = new URL(location, url).toString();

        await validateUrl(target);
        res = await fetchImpl(target, { redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      }

      return res;
    };

    return readerOver(get);
  }

  /** The same for the built-in registry (3.22), through the members over the overlay with a pull token. */
  clusterReader(reference: string, endpoints: string[], token: string, fetchImpl: FetchLike = fetch): RepositoryReader {
    const ref = parseImageReference(reference);

    if (!ref) throw new Error(`invalid image reference ${reference}`);

    const get = async (path: string, accept?: string): Promise<Response> => {
      let last: unknown = new Error('no registry member reachable');

      for (const endpoint of endpoints) {
        try {
          return await fetchImpl(`http://${endpoint}/v2/${ref.repository}/${path}`, {
            headers: { ...(accept ? { Accept: accept } : {}), Authorization: `Bearer ${token}` },
            redirect: 'error',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        } catch (error) {
          last = error;
        }
      }

      throw last;
    };

    return readerOver(get);
  }
}

const NS_PER_MS = 1_000_000;

interface ImageIndexEntry {
  digest: string;
  mediaType?: string;
  platform?: { os?: string; architecture?: string; variant?: string };
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

function platformName(p: NonNullable<ImageIndexEntry['platform']>): string {
  return `${p.os ?? 'unknown'}/${p.architecture ?? 'unknown'}${p.variant ? `/${p.variant}` : ''}`;
}

/** Node architectures images are pinned for (3.35): the `platformLayers` keys of a generic microVM. */
export type ImageArchitecture = 'amd64' | 'arm64';

interface TopManifest {
  manifest: Record<string, unknown> & { layers?: unknown };
  manifestDigest: string;
  /** Index children with a real platform (attestations dropped). */
  real: ImageIndexEntry[];
  /** A single child without platform (e.g. a VM artifact index): the image itself. */
  platformless?: ImageIndexEntry;
  platforms: string[];
  index: boolean;
}

async function readTop(reader: RepositoryReader, reference: string): Promise<TopManifest> {
  const ref = parseImageReference(reference);

  if (!ref) throw new Error(`invalid image reference ${reference}`);

  const top = ref.digest ?? ref.tag ?? 'latest';
  const manifest = await reader.manifest(top, MANIFEST_ACCEPT);

  if (!manifest) throw new Error(`image ${reference} not found`);

  if (!Array.isArray(manifest['manifests']))
    return { manifest, manifestDigest: ref.digest ?? '', real: [], platforms: [], index: false };

  const children = (manifest['manifests'] as ImageIndexEntry[]).filter(
    (c) => typeof c.digest === 'string' && DIGEST.test(c.digest),
  );
  const real = children.filter((c) => c.platform && c.platform.os !== 'unknown');

  return {
    manifest,
    manifestDigest: ref.digest ?? '',
    real,
    ...(children.length === 1 && !children[0].platform ? { platformless: children[0] } : {}),
    platforms: real.map((c) => platformName(c.platform ?? {})),
    index: true,
  };
}

function childFor(top: TopManifest, arch: ImageArchitecture): ImageIndexEntry | undefined {
  return top.real.find((c) => c.platform?.os === 'linux' && c.platform.architecture === arch) ?? top.platformless;
}

async function childManifest(
  reader: RepositoryReader,
  reference: string,
  digest: string,
): Promise<Record<string, unknown> & { layers?: unknown }> {
  const manifest = await reader.manifest(digest, MANIFEST_ACCEPT);

  if (!manifest) throw new Error(`image ${reference}: manifest ${digest} not found`);

  return manifest;
}

/**
 * Reads what a microVM / VM needs from a pinned image (3.35) at plan time: for an index, the `linux/<arch>` child; for
 * a container image, its labels (Agenstra's microVM label decides bundled vs. generic), the process config and the
 * layers with their diff ids (the node verifies both while unpacking); for a VM image artifact
 * (`application/vnd.loadweaver.vm-image.v1`), its config and disk layer.
 */
export async function inspectImage(
  reader: RepositoryReader,
  reference: string,
  arch: ImageArchitecture = 'amd64',
): Promise<ImageInspection> {
  const top = await readTop(reader, reference);

  if (!top.index) return await inspectManifest(reader, reference, top.manifest, top.manifestDigest, [], arch);

  const child = childFor(top, arch);

  if (!child)
    throw new Error(
      `image ${reference} has no linux/${arch} variant (platforms: ${top.platforms.join(', ') || 'none'})`,
    );

  return await inspectManifest(
    reader,
    reference,
    await childManifest(reader, reference, child.digest),
    child.digest,
    top.platforms,
    arch,
  );
}

/** Compressed bytes of a layer read to find a containerDisk's disk entry (it comes first in KubeVirt's images). */
export const CONTAINER_DISK_PREFIX_BYTES = 256 * 1024;
const TAR_BLOCK = 512;

/**
 * `inspectImage` for a VM's image (3.35): a VM image artifact as it is, else a KubeVirt containerDisk — a regular
 * image whose layer holds `/disk/*.qcow2|*.img` — is recognised by peeking at the first tar headers of its layers
 * (last first): the disk's format, path and virtual size (qcow2 header / raw entry size) become the `vmImage`.
 * Anything else comes back without `vmImage` (the plan reports it).
 */
export async function inspectVmImage(
  reader: RepositoryReader,
  reference: string,
  arch: ImageArchitecture = 'amd64',
): Promise<ImageInspection> {
  const inspection = await inspectImage(reader, reference, arch);

  if (inspection.vmImage || !reader.blobPrefix) return inspection;

  const imageArch = inspection.platform.split('/')[1];

  if (imageArch !== 'amd64' && imageArch !== 'arm64') return inspection;

  for (const layer of [...inspection.layers].reverse()) {
    const prefix = await reader.blobPrefix(layer.digest, CONTAINER_DISK_PREFIX_BYTES).catch(() => null);
    const disk = prefix ? containerDiskEntry(await decompressedPrefix(prefix)) : null;

    if (!disk) continue;

    return {
      ...inspection,
      vmImage: {
        arch: imageArch,
        format: disk.format,
        layerDigest: layer.digest,
        virtualSize: disk.virtualSize,
        firmware: imageArch === 'amd64' ? ['uefi', 'bios'] : ['uefi'],
        containerDisk: { path: disk.path },
      },
    };
  }

  return inspection;
}

/** The decompressed start of a (gzip / zstd / plain) layer prefix; a truncated stream yields what it could decode. */
export async function decompressedPrefix(prefix: Buffer, max = 4 * CONTAINER_DISK_PREFIX_BYTES): Promise<Buffer> {
  const kind = detectVmDiskFormat(prefix);

  if (kind !== 'gzip' && kind !== 'zstd') return prefix;

  // zstd needs Node.js 22.15+ (not in the typings yet); without it zstd layers can't be peeked into.
  const createZstd = (zlib as unknown as { createZstdDecompress?: () => Transform }).createZstdDecompress;

  if (kind === 'zstd' && !createZstd) return Buffer.alloc(0);

  const stream: Transform = kind === 'gzip' ? zlib.createGunzip() : (createZstd as () => Transform)();
  const chunks: Buffer[] = [];
  let size = 0;

  return await new Promise<Buffer>((resolve) => {
    const done = () => {
      stream.removeAllListeners('data');
      resolve(Buffer.concat(chunks));
    };

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;

      if (size >= max) {
        stream.destroy();
        done();
      }
    });
    stream.on('end', done);
    stream.on('error', done);
    stream.end(prefix);
  });
}

function tarString(block: Buffer, start: number, length: number): string {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);

  return raw.subarray(0, end < 0 ? raw.length : end).toString('utf8');
}

/**
 * The first containerDisk disk entry (`/disk/<file>.qcow2|.img`) in the start of a tar: its path, format and
 * virtual size (qcow2: from the image header, which must be in `data`; raw: the entry size). Handles ustar prefixes,
 * pax `path` records and GNU long names; null when the visible part has none.
 */
export function containerDiskEntry(
  data: Buffer,
): { path: string; format: 'qcow2' | 'raw'; virtualSize: number } | null {
  let offset = 0;
  let longName: string | null = null;

  while (offset + TAR_BLOCK <= data.length) {
    const block = data.subarray(offset, offset + TAR_BLOCK);

    if (block.every((b) => b === 0)) return null;

    const size = parseInt(tarString(block, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(block[156] || 0x30);
    const prefix = tarString(block, 345, 155);
    const body = offset + TAR_BLOCK;
    const next = body + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;

    if (!Number.isFinite(size) || size < 0) return null;

    if (type === 'x' || type === 'L') {
      if (body + size > data.length) return null;

      const content = data.subarray(body, body + size).toString('utf8');

      longName =
        type === 'L' ? content.replace(/\0+$/, '') : (/(?:^|\n)\d+ path=([^\n]*)\n/.exec(content)?.[1] ?? longName);
      offset = next;
      continue;
    }

    const name = longName ?? (prefix ? `${prefix}/${tarString(block, 0, 100)}` : tarString(block, 0, 100));

    longName = null;

    const format = type === '0' || type === '\0' ? containerDiskFormat(name) : null;

    if (format === 'raw' && size > 0) return { path: name, format, virtualSize: size };

    if (format === 'qcow2') {
      const virtualSize = qcow2VirtualSize(data.subarray(body, Math.min(body + 64, data.length)));

      return virtualSize ? { path: name, format, virtualSize } : null;
    }

    offset = next;
  }

  return null;
}

/**
 * `inspectImage` for every architecture of the cluster's workload nodes (3.35, mixed-arch clusters): one inspection
 * per available architecture; the result is the first available one in `arches` order (labels, process config) with
 * `platformLayers` (each architecture's layers) — the node unpacks its own list. `missing` lists the cluster's
 * architectures the image lacks (the scheduler keeps the replicas off those nodes). With at most one architecture
 * this is exactly `inspectImage` (no `platformLayers`: spec hashes of single-arch clusters stay as they were).
 * Throws when the image has none of the architectures.
 */
export async function inspectImageArchitectures(
  reader: RepositoryReader,
  reference: string,
  arches: readonly ImageArchitecture[],
): Promise<{ inspection: ImageInspection; missing: ImageArchitecture[] }> {
  const wanted = [...new Set(arches)];

  if (wanted.length <= 1) return { inspection: await inspectImage(reader, reference, wanted[0]), missing: [] };

  const top = await readTop(reader, reference);
  const found = new Map<ImageArchitecture, ImageInspection>();

  if (top.index && !top.platformless) {
    const byDigest = new Map<string, ImageInspection>();

    for (const arch of wanted) {
      const child = childFor(top, arch);

      if (!child) continue;

      const inspection =
        byDigest.get(child.digest) ??
        (await inspectManifest(
          reader,
          reference,
          await childManifest(reader, reference, child.digest),
          child.digest,
          top.platforms,
          arch,
        ));

      byDigest.set(child.digest, inspection);
      found.set(arch, inspection);
    }
  } else {
    // A single platform: its architecture comes from its config (container config or VM image config).
    const [manifest, digest] = top.platformless
      ? [await childManifest(reader, reference, top.platformless.digest), top.platformless.digest]
      : [top.manifest, top.manifestDigest];
    const inspection = await inspectManifest(reader, reference, manifest, digest, top.platforms, null);
    const arch = inspection.vmImage?.arch ?? inspection.platform.split('/')[1];

    if (wanted.includes(arch as ImageArchitecture)) found.set(arch as ImageArchitecture, inspection);
  }

  const available = wanted.filter((a) => found.has(a));

  if (available.length === 0)
    throw new Error(
      `image ${reference} has no variant for the cluster's architectures ${wanted.map((a) => `linux/${a}`).join(', ')} (platforms: ${top.platforms.join(', ') || 'none'})`,
    );

  const primary = found.get(available[0]) as ImageInspection;

  return {
    inspection: primary.vmImage
      ? primary
      : {
          ...primary,
          platformLayers: Object.fromEntries(
            available.map((a) => [a, (found.get(a) as ImageInspection).layers.map((l) => ({ ...l }))]),
          ),
        },
    missing: wanted.filter((a) => !found.has(a)),
  };
}

/** One platform manifest; `arch` null: no architecture check (the caller reads it from the result). */
async function inspectManifest(
  reader: RepositoryReader,
  reference: string,
  manifest: Record<string, unknown> & { layers?: unknown },
  manifestDigest: string,
  platforms: string[],
  arch: ImageArchitecture | null,
): Promise<ImageInspection> {
  const config = manifest['config'] as OciDescriptor | undefined;
  const layers = (manifest.layers ?? []) as OciDescriptor[];

  if (!config || !DIGEST.test(config.digest)) throw new Error(`image ${reference} has no config`);

  if (manifest['artifactType'] === VM_IMAGE_ARTIFACT_TYPE || config.mediaType === VM_IMAGE_CONFIG_MEDIA_TYPE) {
    const parsed = vmImageConfigSchema.safeParse(JSON.parse((await reader.blob(config.digest)).toString('utf8')));

    if (!parsed.success) throw new Error(`VM image ${reference} has an invalid config`);

    const disk = layers[0];
    const format = disk ? vmImageFormatOfMediaType(disk.mediaType) : null;

    if (!disk || layers.length !== 1 || !format || !DIGEST.test(disk.digest))
      throw new Error(`VM image ${reference} must have exactly one qcow2 or raw+zstd disk layer`);

    if (arch && parsed.data.arch !== arch) throw new Error(`VM image ${reference} is ${parsed.data.arch}, not ${arch}`);

    return {
      manifestDigest,
      platform: `linux/${parsed.data.arch}`,
      platforms,
      labels: {},
      config: {},
      layers: [],
      vmImage: {
        arch: parsed.data.arch,
        format,
        layerDigest: disk.digest,
        virtualSize: parsed.data.virtualSize,
        firmware: parsed.data.firmware,
        ...(parsed.data.guestAgent !== undefined ? { guestAgent: parsed.data.guestAgent } : {}),
      },
    };
  }

  const blob = JSON.parse((await reader.blob(config.digest)).toString('utf8')) as {
    architecture?: string;
    os?: string;
    config?: Record<string, unknown>;
    rootfs?: { diff_ids?: unknown };
  };
  const diffIds = stringList(blob.rootfs?.diff_ids) ?? [];

  if (diffIds.length !== layers.length || diffIds.some((d) => !DIGEST.test(d)))
    throw new Error(`image ${reference}: layers and diff ids don't match`);

  const c = blob.config ?? {};
  const hc = c['Healthcheck'] as
    | { Test?: unknown; Interval?: number; Timeout?: number; Retries?: number; StartPeriod?: number }
    | undefined;
  const test = stringList(hc?.Test);
  const ms = (ns: number | undefined) => (typeof ns === 'number' && ns > 0 ? Math.round(ns / NS_PER_MS) : undefined);
  const imageLayers: ImageLayer[] = layers.map((l, i) => ({
    digest: l.digest,
    diffId: diffIds[i],
    size: l.size,
    mediaType: l.mediaType,
  }));

  return {
    manifestDigest,
    platform: `${blob.os ?? 'linux'}/${blob.architecture || arch || 'amd64'}`,
    platforms,
    labels: Object.fromEntries(
      Object.entries((c['Labels'] as Record<string, unknown> | null) ?? {}).map(([k, v]) => [k, String(v)]),
    ),
    config: {
      ...(stringList(c['Entrypoint']) ? { entrypoint: stringList(c['Entrypoint']) } : {}),
      ...(stringList(c['Cmd']) ? { cmd: stringList(c['Cmd']) } : {}),
      ...(stringList(c['Env']) ? { env: stringList(c['Env']) } : {}),
      ...(typeof c['User'] === 'string' && c['User'] ? { user: c['User'] } : {}),
      ...(typeof c['WorkingDir'] === 'string' && c['WorkingDir'] ? { workingDir: c['WorkingDir'] } : {}),
      ...(typeof c['StopSignal'] === 'string' && c['StopSignal'] ? { stopSignal: c['StopSignal'] } : {}),
      ...(test?.length
        ? {
            healthcheck: {
              test,
              ...(ms(hc?.Interval) ? { intervalMs: ms(hc?.Interval) } : {}),
              ...(ms(hc?.Timeout) ? { timeoutMs: ms(hc?.Timeout) } : {}),
              ...(typeof hc?.Retries === 'number' && hc.Retries > 0 ? { retries: hc.Retries } : {}),
              ...(ms(hc?.StartPeriod) ? { startPeriodMs: ms(hc?.StartPeriod) } : {}),
            },
          }
        : {}),
    },
    layers: imageLayers,
  };
}

/** Signature manifests and payloads are small; anything bigger isn't one. */
const MAX_READ_BYTES = 1024 * 1024;

async function limited(res: Response): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of (res.body ?? []) as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;

    if (size > MAX_READ_BYTES) throw new Error('response too large');

    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

/** The first `bytes` of a response body; the rest isn't downloaded (the body is cancelled). */
async function prefixOf(res: Response, bytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const body = res.body?.getReader();

  if (!body) return Buffer.alloc(0);

  try {
    while (size < bytes) {
      const { done, value } = await body.read();

      if (done || !value) break;

      chunks.push(Buffer.from(value));
      size += value.length;
    }
  } finally {
    await body.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks).subarray(0, bytes);
}

function readerOver(get: (path: string, accept?: string) => Promise<Response>): RepositoryReader {
  return {
    manifest: async (reference, accept) => {
      const res = await get(`manifests/${reference}`, accept ?? 'application/vnd.oci.image.manifest.v1+json');

      if (res.status === 404) return null;

      if (!res.ok) throw new Error(`manifest ${reference}: HTTP ${res.status}`);

      return JSON.parse((await limited(res)).toString('utf8'));
    },
    blob: async (digest) => {
      if (!DIGEST.test(digest)) throw new Error('invalid digest');

      const res = await get(`blobs/${digest}`);

      if (!res.ok) throw new Error(`blob ${digest}: HTTP ${res.status}`);

      return await limited(res);
    },
    blobPrefix: async (digest, bytes) => {
      if (!DIGEST.test(digest)) throw new Error('invalid digest');

      const res = await get(`blobs/${digest}`);

      if (!res.ok) throw new Error(`blob ${digest}: HTTP ${res.status}`);

      return await prefixOf(res, bytes);
    },
  };
}
