import { randomBytes } from 'node:crypto';

import {
  aptBundleIndexSchema,
  aptUpstreams,
  hostOs,
  importAptBundlePacks,
  serveAptFile,
  snapshotId,
  takeSnapshot,
  type AptFetchImpl,
  type PoolIndex,
  type ReleaseManifest,
  type ServedFile,
} from '@forepath/loadweaver/shared/util-release';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';
import { ArtifactStore } from './artifact-store';
import { AptFileEntity, AptSnapshotEntity } from './apt.entity';

/**
 * The cluster-local apt source (3.26): frozen snapshots of the upstream indexes, taken at plan time (or shipped in a
 * bundle for air-gapped clusters), served on `/api/updates/apt/<snapshot>/<source>/…`. See `apt-snapshot.core.ts` in util-release.
 */
@Injectable()
export class AptSnapshotService {
  private readonly logger = new Logger(AptSnapshotService.name);
  /** Overridable for tests. */
  fetchImpl: AptFetchImpl | undefined;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly artifacts: ArtifactStore,
  ) {}

  private pool(): PoolIndex {
    const repo = this.dataSource.getRepository(AptFileEntity);

    return {
      get: async (sourceUrl, path) => {
        const row = await repo.findOne({ where: { sourceUrl, path } });

        return row ? { sha256: row.sha256, size: Number(row.size) } : null;
      },
      set: async (sourceUrl, path, sha256, size) => {
        await repo.upsert({ sourceUrl, path, sha256, size: String(size) }, ['sourceUrl', 'path']);
      },
    };
  }

  /** Freezes the upstream indexes for the OS / architecture combinations of the cluster's nodes. */
  async createSnapshot(): Promise<AptSnapshotEntity> {
    const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    const hosts = nodes
      .map((n) => ({ os: hostOs(n.os), arch: n.os?.arch ?? 'amd64' }))
      .filter((h): h is { os: string; arch: string } => !!h.os);
    const sources = aptUpstreams(hosts);

    if (sources.length === 0) throw new Error('no node runs a supported OS');

    // Integrity does not depend on the transport (InRelease is verified by apt on the node, pool files against the
    // frozen indexes), but plain http leaks what the cluster installs and invites tampering attempts.
    for (const source of sources.filter((s) => s.url.startsWith('http://')))
      this.logger.warn(`apt source ${source.name} uses plain http (${source.url}); prefer an https mirror`);

    const files = await takeSnapshot(sources, this.artifacts, this.fetchImpl);
    const repo = this.dataSource.getRepository(AptSnapshotEntity);

    return await repo.save(
      repo.create({ id: snapshotId(new Date(), randomBytes(4).toString('hex')), sources, files, origin: 'plan' }),
    );
  }

  /**
   * Registers the apt snapshot a bundle ships (air-gapped, `apt-bundle.ts`): its index (`{ id, sources, files, pool }`)
   * is an artifact, the files it names come in the per-OS packs (`aptPackages`, artifacts too — signed, verified on
   * import). The packs are unpacked into the artifact store by checksum and the pool files registered, so the snapshot
   * is served from the bundle without upstream.
   */
  async importBundleSnapshot(manifest: ReleaseManifest): Promise<string | undefined> {
    const file = manifest.artifacts.find((a) => a.path === manifest.aptSnapshot);

    if (!file) return undefined;

    const data = await this.artifacts.getBuffer(file.sha256, 64 * 1024 * 1024);

    if (!data) return undefined;

    const parsed = aptBundleIndexSchema.safeParse(JSON.parse(data.toString('utf8')));

    if (!parsed.success)
      throw new Error(
        `invalid apt snapshot index in the bundle: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );

    const index = parsed.data;
    const packs = (manifest.aptPackages ?? []).map((path) => {
      const pack = manifest.artifacts.find((a) => a.path === path);

      if (!pack) throw new Error(`apt pack ${path} is not an artifact of the bundle`);

      return this.packStream(pack.sha256);
    });
    const result = await importAptBundlePacks(index, packs, this.artifacts, this.pool());

    if (result.missing.length)
      this.logger.warn(
        `Bundle apt snapshot ${index.id}: ${result.missing.length} file(s) not in the bundle (fetched from upstream if reachable), e.g. ${result.missing.slice(0, 3).join(', ')}`,
      );

    this.logger.log(
      `Bundle apt snapshot ${index.id}: ${index.pool.length} packages, ${result.stored} files stored, ${result.present} already present`,
    );

    await this.dataSource.getRepository(AptSnapshotEntity).save({
      id: index.id,
      sources: index.sources,
      files: index.files,
      origin: 'bundle',
    });

    return index.id;
  }

  /** A pack's bytes from the artifact store (opened when the import reaches it). */
  private async *packStream(sha256: string): AsyncGenerator<Buffer> {
    const found = await this.artifacts.get(sha256);

    if (!found) throw new Error(`apt pack ${sha256} is missing from the artifact store`);

    for await (const chunk of found.stream) yield Buffer.from(chunk as Buffer);
  }

  async get(id: string): Promise<AptSnapshotEntity | null> {
    return /^[a-z0-9][a-z0-9-]{0,62}$/.test(id)
      ? await this.dataSource.getRepository(AptSnapshotEntity).findOne({ where: { id } })
      : null;
  }

  /** The newest snapshot (the node installer takes Ubuntu's KVM modules from it, 3.1). */
  async latest(): Promise<AptSnapshotEntity | null> {
    const [newest] = await this.dataSource
      .getRepository(AptSnapshotEntity)
      .find({ order: { createdAt: 'DESC' }, take: 1 });

    return newest ?? null;
  }

  async serve(id: string, source: string, path: string): Promise<ServedFile | null> {
    const snapshot = await this.get(id);

    if (!snapshot) return null;

    return await serveAptFile(snapshot, source, path, this.artifacts, this.pool(), this.fetchImpl);
  }
}
