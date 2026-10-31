import type { RequestWithUser } from '@forepath/identity/backend';
import {
  clusterVmImagesSchema,
  type ClusterVmImage,
  type VmImageCatalogEntry,
} from '@forepath/loadweaver/shared/util-model';
import { validateWebhookUrlWithDnsOrThrow } from '@forepath/shared/backend/util-webhook';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { hasAnyRole } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { ResourceEntity } from '../entities/resource.entity';
import { SHIPPED_VM_IMAGES } from '../utils/vm-image-catalog.data';
import { UPSTREAM_LINES, type UpstreamImage, type UpstreamLine } from '../utils/vm-image-upstream.utils';

/** Results of a line are kept this long (failures shorter, so a hiccup upstream heals quickly). */
const CACHE_MS = 10 * 60_000;
const FAILURE_CACHE_MS = 60_000;
/** One line (all its requests) may take this long. */
const LINE_TIMEOUT_MS = 10_000;
/** Checksum lists and index pages are small; anything larger is refused. */
const MAX_DOCUMENT_BYTES = 2 * 1024 ** 2;
const MAX_REDIRECTS = 3;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type CatalogDraft = Omit<VmImageCatalogEntry, 'suggestedRef'>;

/**
 * Suggested `<repository>:<tag>` per entry: `<distro>:<version>`, with an arch suffix where another entry of the
 * same distro and version has a different arch (`ubuntu:24.04` and `ubuntu:24.04-arm64`).
 */
export function withSuggestedRefs(drafts: readonly CatalogDraft[]): VmImageCatalogEntry[] {
  return drafts.map((entry) => {
    const sibling = drafts.some(
      (other) => other.distro === entry.distro && other.version === entry.version && other.arch !== entry.arch,
    );

    return {
      ...entry,
      suggestedRef: `${entry.distro}:${entry.version}${sibling && entry.arch !== 'amd64' ? `-${entry.arch}` : ''}`,
    };
  });
}

export function shippedCatalog(): VmImageCatalogEntry[] {
  return withSuggestedRefs(
    SHIPPED_VM_IMAGES.map((image) => ({
      ...image,
      id: `${image.distro}-${image.version}-${image.arch}`,
      source: 'shipped' as const,
    })),
  );
}

/** `Cluster.spec.vmImages.catalog[]` as catalog entries (`cluster:<name>-<arch>`). */
export function clusterCatalog(images: readonly ClusterVmImage[]): VmImageCatalogEntry[] {
  return withSuggestedRefs(
    images.map((image) => ({
      id: `cluster:${image.name}-${image.arch}`,
      source: 'cluster' as const,
      distro: image.name,
      label: image.label ?? image.name,
      version: image.version,
      arch: image.arch,
      url: image.url,
      checksum: image.sha512
        ? { algorithm: 'sha512' as const, value: image.sha512.toLowerCase().replace(/^sha512:/, '') }
        : { algorithm: 'sha256' as const, value: (image.sha256 ?? '').toLowerCase().replace(/^sha256:/, '') },
      ...(image.firmware ? { firmware: image.firmware } : {}),
      ...(image.guestAgent !== undefined ? { guestAgent: image.guestAgent } : {}),
      ...(image.description ? { description: image.description } : {}),
    })),
  );
}

export function upstreamCatalog(images: readonly UpstreamImage[]): VmImageCatalogEntry[] {
  return withSuggestedRefs(
    images.map((image) => ({
      ...image,
      id: `upstream:${image.distro}-${image.version}-${image.arch}-${image.build}`,
      source: 'upstream' as const,
    })),
  );
}

/**
 * VM image catalog (3.42): the recommended images shipped with the release, the cluster's own entries
 * (`Cluster.spec.vmImages`), and the live lookup of the distros' published checksum lists ("other versions"). Readable
 * by anyone with a project membership or a cluster role; choosing an entry runs the normal import of the project.
 */
@Injectable()
export class VmImageCatalogEntriesService {
  private readonly logger = new Logger(VmImageCatalogEntriesService.name);
  private readonly cache = new Map<string, { at: number; ttl: number; result: Promise<UpstreamImage[]> }>();
  /** Test seams. */
  fetchImpl: Fetch = (url, init) => fetch(url, init);
  validateUrl: (url: string) => Promise<unknown> = validateWebhookUrlWithDnsOrThrow;
  lines: readonly UpstreamLine[] = UPSTREAM_LINES;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  /** Shipped and cluster entries. */
  async catalog(req: RequestWithUser | undefined): Promise<{ entries: VmImageCatalogEntry[] }> {
    await this.assertAudience(req);

    const cluster = await this.dataSource
      .getRepository(ResourceEntity)
      .findOne({ where: { kind: 'Cluster', projectKey: '' } });
    const parsed = clusterVmImagesSchema.safeParse(cluster?.spec?.['vmImages'] ?? {});

    if (!parsed.success) this.logger.warn('Cluster.spec.vmImages is invalid; listing the shipped catalog only');

    return { entries: [...shippedCatalog(), ...clusterCatalog(parsed.success ? parsed.data.catalog : [])] };
  }

  /** Current builds of every line; a line that fails yields no entries and a warning (never an error). */
  async upstream(req: RequestWithUser | undefined): Promise<{ entries: VmImageCatalogEntry[]; warnings: string[] }> {
    await this.assertAudience(req);

    const results = await Promise.all(
      this.lines.map(async (line) => {
        try {
          return { images: await this.lookup(line), warning: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          return { images: [], warning: `${line.id}: ${message}` };
        }
      }),
    );

    return {
      entries: upstreamCatalog(results.flatMap((r) => r.images)),
      warnings: results.flatMap((r) => (r.warning ? [r.warning] : [])),
    };
  }

  private async assertAudience(req: RequestWithUser | undefined): Promise<void> {
    if (!hasAnyRole(await this.access.caller(req)))
      throw new ForbiddenException('the VM image catalog needs a project membership or a cluster role');
  }

  private async lookup(line: UpstreamLine, now = Date.now()): Promise<UpstreamImage[]> {
    const cached = this.cache.get(line.id);

    if (cached && now - cached.at < cached.ttl) return await cached.result;

    const entry = { at: now, ttl: CACHE_MS, result: this.runLine(line) };

    this.cache.set(line.id, entry);
    entry.result.catch((error: unknown) => {
      entry.ttl = FAILURE_CACHE_MS;
      this.logger.warn(
        `VM image catalog: ${line.id} lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    return await entry.result;
  }

  private async runLine(line: UpstreamLine): Promise<UpstreamImage[]> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`no answer within ${LINE_TIMEOUT_MS / 1000} s`)),
      LINE_TIMEOUT_MS,
    );
    const aborted = new Promise<never>((_resolve, reject) =>
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }),
    );

    aborted.catch(() => undefined);

    try {
      // The race also ends a line stuck in the address check, which takes no signal.
      return await Promise.race([line.lookup((url) => this.get(url, controller.signal)), aborted]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET with https only, the SSRF check on every redirect hop and a size cap. */
  private async get(start: string, signal: AbortSignal): Promise<string> {
    let url = start;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (new URL(url).protocol !== 'https:') throw new Error('upstream sources must use https');

      await this.validateUrl(url);

      const response = await this.fetchImpl(url, { redirect: 'manual', signal });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');

        if (!location) throw new Error(`redirect without a location (${response.status})`);

        url = new URL(location, url).toString();
        continue;
      }

      if (!response.ok || !response.body) throw new Error(`${new URL(url).host}: HTTP ${response.status}`);

      return await readCapped(response, MAX_DOCUMENT_BYTES);
    }

    throw new Error('too many redirects');
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes)
    throw new Error(`index larger than ${maxBytes} bytes`);

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    bytes += value.length;

    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`index larger than ${maxBytes} bytes`);
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
}
