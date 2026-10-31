import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { clusterSpecSchema, type ClusterUpdates } from '@forepath/loadweaver/shared/util-model';
import {
  BundleError,
  imageComponents,
  normalizeVersion,
  readBundle,
  trustedReleaseKeys,
  unsignedBundlesAllowed,
  unsignedBundlesNotice,
  type ReleaseManifest,
  type VerifiedManifest,
} from '@forepath/loadweaver/shared/util-release';
import { BadRequestException, ConflictException, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { REGISTRY_PRIVATE_PORT } from '../object-store/registry-state.utils';
import { AuditLogService, type AuditActor } from '../services/audit-log.service';
import { nodeAddress } from '../services/object-store-controller.service';
import { RegistryTokenService } from '../services/registry-token.service';
import { ArtifactStore } from './artifact-store';
import { AptSnapshotService } from './apt-snapshot.service';
import { importOciArchive, SYSTEM_REPOSITORY_PREFIX } from './registry-import';
import { ReleaseEntity, type ReleaseSource } from './release.entity';

/**
 * Largest accepted bundle (bytes); `LOADWEAVER_BUNDLE_MAX_BYTES` overrides. 16 GiB: release bundles carry the images
 * plus the apt snapshot's packages for every supported OS release / architecture (several GB, see `updates.md`).
 */
export function bundleMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['LOADWEAVER_BUNDLE_MAX_BYTES']);

  return Number.isFinite(raw) && raw >= 1024 * 1024 ? raw : 16 * 1024 ** 3;
}

/** `owner/repo` the GitHub release bundles come from. */
export function releaseRepository(env: NodeJS.ProcessEnv = process.env): string {
  const repo = env['LOADWEAVER_RELEASES_REPOSITORY']?.trim() || 'forepath/one';

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('invalid LOADWEAVER_RELEASES_REPOSITORY');

  return repo;
}

/** Download URL of a release bundle: the GitHub release asset or the configured mirror. */
export function bundleUrl(version: string, updates: Pick<ClusterUpdates, 'source' | 'mirrorUrl'>): string {
  const file = `loadweaver-bundle-${version}.tar`;

  if (updates.source === 'mirror' && updates.mirrorUrl)
    return `${updates.mirrorUrl.replace(/\/+$/, '')}/${version}/${file}`;

  return `https://github.com/${releaseRepository()}/releases/download/v${version}/${file}`;
}

/** The parts of a split bundle in order, as one stream; a missing first part is an error, later ones end it. */
export async function* bundleParts(url: string, get: (url: string) => Promise<Response>): AsyncGenerator<Uint8Array> {
  for (let part = 0; part < 1000; part++) {
    const response = await get(`${url}.part${String(part).padStart(3, '0')}`);

    if (response.status === 404 && part > 0) return;

    if (!response.ok || !response.body)
      throw new BadRequestException(
        `bundle download failed: HTTP ${response.status} for part ${part} from ${new URL(url).host}`,
      );

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) yield chunk;
  }
}

/**
 * Release bundles (3.26): downloaded once (GitHub release or mirror) or uploaded (air-gapped, streamed and
 * size-capped), verified against the compiled-in release keys before anything is stored, then imported — every
 * artifact into the object store by checksum, OCI images into the cluster registry (`lw-system/<component>`), the
 * bundled apt snapshot (if any). Nodes only ever fetch from the cluster.
 */
/**
 * An upload with a declared length + SHA-256 (`Content-Length`, `X-Loadweaver-Content-SHA256`; a fleet claim may bind
 * these instead of the body, 2026-10-27): the bytes are hashed as they pass; `verify()` reads what the bundle reader
 * left (tar padding) and refuses the import unless length and digest match — before the release becomes available.
 */
export function declaredDigestSource(
  source: AsyncIterable<Uint8Array | string>,
  declared: { length: number; sha256: string },
): { source: AsyncIterable<Uint8Array>; verify: () => Promise<void> } {
  const hash = createHash('sha256');
  const iterator = source[Symbol.asyncIterator]();
  let seen = 0;
  const take = (chunk: Uint8Array | string): Uint8Array => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;

    seen += bytes.length;

    if (seen > declared.length) throw new BundleError('the upload is longer than its declared length', 'format');

    hash.update(bytes);

    return bytes;
  };

  return {
    source: {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          const step = await iterator.next();

          return step.done ? { done: true, value: undefined } : { done: false, value: take(step.value) };
        },
        // The reader may stop at the tar trailer: keep the underlying stream for verify().
        return: async () => ({ done: true, value: undefined }),
      }),
    },
    verify: async () => {
      for (let step = await iterator.next(); !step.done; step = await iterator.next()) take(step.value);

      if (seen !== declared.length || hash.digest('hex') !== declared.sha256)
        throw new BundleError('the upload does not match its declared length / SHA-256', 'format');
    },
  };
}

@Injectable()
export class BundleService {
  private readonly logger = new Logger(BundleService.name);
  private importing = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly artifacts: ArtifactStore,
    private readonly registryTokens: RegistryTokenService,
    private readonly apt: AptSnapshotService,
    private readonly audit: AuditLogService,
  ) {
    // Loud on every start (M6 review L1); also shown in GET /updates/status.
    const notice = unsignedBundlesNotice();

    if (notice) this.logger.warn(notice);
  }

  async clusterUpdates(): Promise<ClusterUpdates> {
    const cluster = await this.dataSource
      .getRepository(ResourceEntity)
      .findOne({ where: { kind: 'Cluster', projectKey: '' } });
    const spec = clusterSpecSchema.parse(cluster?.spec ?? { network: {} });

    return (
      spec.updates ?? {
        policy: 'auto-patch',
        channel: 'stable',
        source: 'github',
        osUpdates: true,
        settleSeconds: 60,
        stepTimeoutMinutes: 30,
      }
    );
  }

  /** Downloads a release's bundle from its source and imports it. */
  async fetch(versionInput: string, actor: AuditActor): Promise<ReleaseEntity> {
    const version = normalizeVersion(versionInput);

    if (!version) throw new BadRequestException('invalid version');

    const updates = await this.clusterUpdates();

    if (updates.source === 'upload') throw new ConflictException('this cluster imports bundles by upload only');

    const url = bundleUrl(version, updates);
    const get = async (target: string) => {
      const response = await this.fetchImpl(target);

      // Redirects may only go to HTTPS hosts (GitHub hands out object storage URLs).
      if (response.url && !response.url.startsWith('https://'))
        throw new BadRequestException('bundle download left HTTPS');

      return response;
    };
    const whole = await get(url);
    let source: AsyncIterable<Uint8Array>;

    if (whole.ok && whole.body) {
      if (Number(whole.headers.get('content-length') ?? 0) > bundleMaxBytes())
        throw new PayloadTooLargeException('the bundle exceeds the size limit');

      source = Readable.fromWeb(whole.body as never);
    } else if (whole.status === 404) {
      // Release assets are limited in size: large bundles are published in parts (`.part000`, `.part001`, …).
      void whole.body?.cancel();
      source = bundleParts(url, get);
    } else {
      throw new BadRequestException(`bundle download failed: HTTP ${whole.status} from ${new URL(url).host}`);
    }

    return await this.importStream(source, updates.source === 'mirror' ? 'mirror' : 'github', actor, version);
  }

  /** Overridable for tests. */
  fetchImpl: (url: string) => Promise<Response> = (url) =>
    fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(4 * 3600_000) });

  /**
   * Imports a bundle stream (upload or download). `expectVersion`: a download must contain the release it was
   * fetched for. Refused bundles (signature, format, size) leave no stored artifacts.
   */
  async importStream(
    source: AsyncIterable<Uint8Array | string>,
    origin: ReleaseSource,
    actor: AuditActor,
    expectVersion?: string,
    /** Checked after the bundle was read, before the release is recorded ({@link declaredDigestSource}). */
    verifyUpload?: () => Promise<void>,
  ): Promise<ReleaseEntity> {
    if (this.importing) throw new ConflictException('another bundle is being imported on this replica');

    this.importing = true;

    const repo = this.dataSource.getRepository(ReleaseEntity);
    let row: ReleaseEntity | null = null;

    try {
      const verified = await readBundle(source, {
        trustedKeys: trustedReleaseKeys(),
        allowUnsigned: unsignedBundlesAllowed(),
        maxBytes: bundleMaxBytes(),
        onManifest: async (v) => {
          if (expectVersion && v.manifest.version !== expectVersion)
            throw new BundleError(`the bundle is ${v.manifest.version}, expected ${expectVersion}`, 'format');

          const existing = await repo.findOne({ where: { version: v.manifest.version } });

          if (existing?.status === 'available')
            throw new ConflictException(`release ${v.manifest.version} is already imported`);

          // Another replica may be importing it right now.
          if (existing?.status === 'importing' && Date.now() - existing.updatedAt.getTime() < 2 * 3600_000)
            throw new ConflictException(`release ${v.manifest.version} is being imported`);

          row = await repo.save(
            repo.create({
              ...(existing ?? {}),
              version: v.manifest.version,
              channel: v.manifest.channel,
              status: 'importing',
              source: origin,
              error: null,
            }),
          );
        },
        onArtifact: async (file, body) => {
          if (await this.artifacts.has(file.sha256)) {
            for await (const _ of body) void _;

            return;
          }

          await this.artifacts.put(file.sha256, file.size, body);
        },
      });

      await verifyUpload?.();

      return await this.finishImport(verified, origin, actor);
    } catch (error) {
      if (error instanceof ConflictException) throw error;

      const message = error instanceof Error ? error.message : String(error);
      const failedRow = row as ReleaseEntity | null;

      if (failedRow) await repo.update({ id: failedRow.id }, { status: 'failed', error: message.slice(0, 2000) });

      await this.audit.recordStandalone({
        actor,
        action: 'update.bundle-refused',
        target: `release/${failedRow?.version ?? expectVersion ?? 'unknown'}`,
        details: { origin, reason: message.slice(0, 500), kind: error instanceof BundleError ? error.kind : 'import' },
      });

      if (error instanceof BundleError && error.kind === 'size') throw new PayloadTooLargeException(message);

      throw new BadRequestException(`bundle refused: ${message}`);
    } finally {
      this.importing = false;
    }
  }

  private async finishImport(
    verified: VerifiedManifest,
    origin: ReleaseSource,
    actor: AuditActor,
  ): Promise<ReleaseEntity> {
    const { manifest } = verified;
    const clusterImages = await this.importImages(manifest);
    const aptSnapshot = manifest.aptSnapshot ? await this.apt.importBundleSnapshot(manifest) : undefined;
    const repo = this.dataSource.getRepository(ReleaseEntity);

    return await this.dataSource.transaction(async (manager) => {
      const existing = await manager.getRepository(ReleaseEntity).findOne({ where: { version: manifest.version } });
      const saved = await manager.getRepository(ReleaseEntity).save(
        repo.create({
          ...(existing ?? {}),
          version: manifest.version,
          channel: manifest.channel,
          status: 'available',
          source: origin,
          manifestText: verified.manifestBytes.toString('utf8'),
          manifest: manifest as unknown as Record<string, unknown>,
          signature: verified.signature as unknown as Record<string, unknown> | null,
          keyId: verified.keyId,
          imported: {
            clusterImages,
            artifacts: manifest.artifacts.map((a) => a.sha256),
            ...(aptSnapshot ? { aptSnapshot } : {}),
          },
          error: null,
          importedBy: actor.id ?? actor.type,
          importedAt: new Date(),
        }),
      );

      await this.audit.record(manager, {
        actor,
        action: 'update.bundle-imported',
        target: `release/${manifest.version}`,
        details: {
          origin,
          channel: manifest.channel,
          signed: verified.keyId !== null,
          ...(verified.keyId ? { keyId: verified.keyId } : { warning: 'unsigned development bundle' }),
          artifacts: manifest.artifacts.length,
          clusterImages: clusterImages.length,
        },
      });

      return saved;
    });
  }

  /** Pushes the bundle's OCI archives into the cluster registry; without a reachable registry nothing is pushed. */
  private async importImages(manifest: ReleaseManifest): Promise<string[]> {
    const images = Object.entries(imageComponents(manifest)).filter(([, c]) => c.archive);

    if (images.length === 0) return [];

    const members = await this.dataSource
      .getRepository(NodeEntity)
      .find({ where: { controlPlane: true, lifecycle: Not('left'), connected: true }, order: { name: 'ASC' } });
    const host = members.map((n) => nodeAddress(n)).find((a): a is string => !!a);

    if (!host) {
      this.logger.warn('No registry member reachable: bundle images stay in the object store, nodes pull by digest');

      return [];
    }

    const imported: string[] = [];

    for (const [name, component] of images) {
      const file = manifest.artifacts.find((a) => a.path === component.archive);
      const archive = file ? await this.artifacts.get(file.sha256) : null;

      if (!archive) continue;

      try {
        const token = await this.registryTokens.issue(
          'control-plane:updates',
          [{ name: `${SYSTEM_REPOSITORY_PREFIX}/${name}`, actions: ['pull', 'push'] }],
          900,
        );

        await importOciArchive(archive.stream, { host, port: REGISTRY_PRIVATE_PORT, token }, name, component.digest);
        imported.push(name);
      } catch (error) {
        archive.stream.destroy();
        this.logger.warn(
          `Image ${name} not imported into the cluster registry: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return imported;
  }
}
