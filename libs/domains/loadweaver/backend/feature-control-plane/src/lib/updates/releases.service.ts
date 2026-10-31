import type { AptSource, NodeComponents } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  compareVersions,
  hostOs,
  isPrerelease,
  normalizeVersion,
  type ReleaseManifest,
} from '@forepath/loadweaver/shared/util-release';
import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';

import type { NodeEntity } from '../entities/node.entity';
import { AptSnapshotEntity } from './apt.entity';
import { ReleaseEntity, type ReleaseStatus } from './release.entity';
import { RolloutEntity, type StepTarget } from './rollout.entity';

/** Route agents fetch artifacts from: `<base>/<sha256>`. */
export const ARTIFACT_ROUTE = '/api/updates/artifacts';
/** Route of the cluster-local apt source: `<base>/<snapshot>/<source>/…`. */
export const APT_ROUTE = '/api/updates/apt';

export interface ReleaseDto {
  version: string;
  channel: 'stable' | 'beta';
  status: ReleaseStatus;
  source: string;
  signed: boolean;
  keyId: string | null;
  notes: string[];
  components: { name: string; kind: string; version: string }[];
  clusterImages: string[];
  announcement: ReleaseEntity['announcement'];
  error: string | null;
  importedAt: string | null;
  importedBy: string | null;
}

export function toReleaseDto(r: ReleaseEntity): ReleaseDto {
  const manifest = r.manifest as ReleaseManifest | null;

  return {
    version: r.version,
    channel: r.channel,
    status: r.status,
    source: r.source,
    signed: !!r.signature,
    keyId: r.keyId,
    notes: manifest?.notes ?? [],
    components: Object.entries(manifest?.components ?? {})
      .map(([name, c]) => ({ name, kind: c.kind, version: c.version }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    clusterImages: r.imported?.clusterImages ?? [],
    announcement: r.announcement,
    error: r.error,
    importedAt: r.importedAt?.toISOString() ?? null,
    importedBy: r.importedBy,
  };
}

/**
 * Releases known to the cluster (3.26) and what a node's desired state carries for its target release. The
 * installed version (the control plane's `VERSION`) is recorded as the baseline; announced releases come from the
 * shared updates feature; imported bundles are `available`.
 */
@Injectable()
export class ReleasesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReleasesService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.recordInstalled().catch((error: unknown) =>
      this.logger.warn(`Installed release not recorded: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  /** The control plane's own version (`VERSION` / `APP_VERSION`), or null in development builds. */
  installedVersion(env: NodeJS.ProcessEnv = process.env): string | null {
    const version = normalizeVersion(env['VERSION'] ?? env['APP_VERSION'] ?? '');

    return version && version !== '0.0.0' ? version : null;
  }

  private async recordInstalled(): Promise<void> {
    const version = this.installedVersion();

    if (!version) return;

    await this.dataSource.query(
      `INSERT INTO lw_releases (version, channel, status, source) VALUES ($1, $2, 'installed', 'installed')
       ON CONFLICT (version) DO NOTHING`,
      [version, isPrerelease(version) ? 'beta' : 'stable'],
    );
  }

  /** The release the cluster runs: the target of the last completed release rollout, else the installed version. */
  async clusterVersion(): Promise<string | null> {
    const done = await this.dataSource
      .getRepository(RolloutEntity)
      .findOne({ where: { status: 'completed' }, order: { finishedAt: 'DESC' } });

    return done?.toVersion ?? this.installedVersion();
  }

  async list(): Promise<ReleaseDto[]> {
    const rows = await this.dataSource.getRepository(ReleaseEntity).find();

    return rows.sort((a, b) => safeCompare(b.version, a.version)).map(toReleaseDto);
  }

  async get(version: string): Promise<ReleaseEntity> {
    const row = await this.dataSource.getRepository(ReleaseEntity).findOne({ where: { version } });

    if (!row) throw new NotFoundException(`release ${version} not found`);

    return row;
  }

  /** Records a release announced by the shared updates feature (GitHub releases of the channel). */
  async recordAnnouncement(release: {
    tagName: string;
    name: string;
    htmlUrl: string;
    publishedAt: string;
    changelog: string[];
    prerelease?: boolean;
  }): Promise<ReleaseEntity | null> {
    const version = normalizeVersion(release.tagName);

    if (!version) return null;

    const repo = this.dataSource.getRepository(ReleaseEntity);
    const existing = await repo.findOne({ where: { version } });
    const announcement = {
      name: release.name,
      htmlUrl: release.htmlUrl,
      publishedAt: release.publishedAt,
      changelog: release.changelog.slice(0, 200),
    };

    if (existing) {
      await repo.update({ id: existing.id }, { announcement });

      return { ...existing, announcement };
    }

    return await repo.save(
      repo.create({
        version,
        channel: release.prerelease || isPrerelease(version) ? 'beta' : 'stable',
        status: 'announced',
        source: 'github',
        announcement,
      }),
    );
  }

  /** Releases newer than the cluster that can be planned (imported), by channel. */
  async availableNewer(channel: 'stable' | 'beta'): Promise<ReleaseEntity[]> {
    const current = await this.clusterVersion();
    const rows = await this.dataSource.getRepository(ReleaseEntity).find({ where: { status: 'available' } });

    return rows
      .filter(
        (r) => (channel === 'beta' || r.channel === 'stable') && (!current || safeCompare(r.version, current) > 0),
      )
      .sort((a, b) => safeCompare(a.version, b.version));
  }

  /**
   * Resolves the `components` of the nodes' desired states (one load for a whole compilation): the release's
   * signed manifest, artifact route, cluster images, and the host step with the snapshot's sources for the node's OS.
   */
  async componentsResolver(
    targets: readonly (StepTarget | null)[],
  ): Promise<(node: NodeEntity) => NodeComponents | undefined> {
    const versions = [...new Set(targets.flatMap((t) => (t?.release ? [t.release] : [])))];
    const snapshots = [...new Set(targets.flatMap((t) => (t?.host ? [t.host.snapshot] : [])))];
    const releases = versions.length
      ? await this.dataSource
          .getRepository(ReleaseEntity)
          .find({ where: { version: In(versions), status: In(['available', 'installed']) } })
      : [];
    const snapshotRows = snapshots.length
      ? await this.dataSource.getRepository(AptSnapshotEntity).find({ where: { id: In(snapshots) } })
      : [];

    return (node) => {
      const target = node.componentTarget;
      const release = releases.find((r) => r.version === target?.release);

      // A target without an imported, signed (or allowed unsigned) manifest can't be sent: the node keeps what it runs.
      if (!target?.release || !release?.manifestText) return undefined;

      const snapshot = target.host ? snapshotRows.find((s) => s.id === target.host?.snapshot) : undefined;
      const os = hostOs(node.os);
      const sources: AptSource[] = (snapshot?.sources ?? [])
        .filter((s) => s.os === os && s.arches.includes(node.os?.arch ?? 'amd64'))
        .map((s) => ({ name: s.name, suites: s.suites, components: s.components, keyring: s.keyring }));

      return {
        release: release.version,
        manifest: release.manifestText,
        ...(release.signature ? { signature: JSON.stringify(release.signature) } : {}),
        artifactBase: ARTIFACT_ROUTE,
        ...(release.imported?.clusterImages.length ? { clusterImages: release.imported.clusterImages } : {}),
        ...(target.host && snapshot
          ? {
              host: {
                id: target.host.id,
                snapshot: snapshot.id,
                aptBase: `${APT_ROUTE}/${snapshot.id}`,
                sources,
                upgrade: target.host.upgrade,
                ...(target.host.spaas ? { spaas: true } : {}),
                ...(target.host.reboot ? { reboot: target.host.reboot } : {}),
              },
            }
          : {}),
        ...(target.actions?.patroniSwitchover
          ? { actions: { patroniSwitchover: target.actions.patroniSwitchover } }
          : {}),
      };
    };
  }
}

function safeCompare(a: string, b: string): number {
  try {
    return compareVersions(a, b);
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
}
