import { compareVersions, updateKind } from '@forepath/loadweaver/shared/util-release';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, MoreThan } from 'typeorm';

import { ResourceEntity } from '../entities/resource.entity';
import { BundleService } from './bundle.service';
import { ReleaseEntity } from './release.entity';
import { ReleasesService } from './releases.service';
import { ACTIVE_ROLLOUT_STATUSES, RolloutEntity } from './rollout.entity';
import { RolloutService } from './rollout.service';

const TICK_MS = 10 * 60_000;
const ADVISORY_LOCK_UPDATE_POLICY = 0x4c570031;
const OS_UPDATE_INTERVAL_MS = 7 * 24 * 3600_000;
const SYSTEM = { type: 'system' as const, id: 'update-policy' };

/**
 * The cluster's update policy (3.26), evaluated every 10 minutes by one replica:
 * - announced releases newer than the cluster are downloaded and imported (unless the source is `upload`);
 * - `auto-patch`: a newer patch release becomes an update plan approved by the policy (it runs in maintenance
 *   windows); minor / major releases become plans waiting for an approval; OS updates (frozen snapshot + reboots)
 *   are planned weekly when `osUpdates` is on and windows exist;
 * - `notify`: plans are created by people; `manual`: nothing automatic.
 */
@Injectable()
export class UpdatePolicyService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(UpdatePolicyService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly releases: ReleasesService,
    private readonly rollouts: RolloutService,
    private readonly bundles: BundleService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['LOADWEAVER_UPDATE_POLICY'] === 'off') return;

    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = Date.now()): Promise<string[]> {
    const runner = this.dataSource.createQueryRunner();

    try {
      await runner.connect();

      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        ADVISORY_LOCK_UPDATE_POLICY,
      ]);

      if (!locked) return [];

      try {
        return await this.evaluate(now);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_UPDATE_POLICY]);
      }
    } catch (error) {
      this.logger.warn(`Update policy: ${error instanceof Error ? error.message : String(error)}`);

      return [];
    } finally {
      await runner.release();
    }
  }

  /** What the policy did (for logs and tests). */
  async evaluate(now: number): Promise<string[]> {
    const updates = await this.bundles.clusterUpdates();
    const actions: string[] = [];

    if (updates.policy === 'manual') return actions;

    const current = await this.releases.clusterVersion();
    const newer = (version: string) => {
      try {
        return !current || compareVersions(version, current) > 0;
      } catch {
        return false;
      }
    };

    // Download announced releases of the channel once.
    if (updates.source !== 'upload') {
      const announced = await this.dataSource
        .getRepository(ReleaseEntity)
        .find({ where: { status: In(['announced', 'failed']) } });

      for (const release of announced.filter(
        (r) =>
          newer(r.version) &&
          (updates.channel === 'beta' || r.channel === 'stable') &&
          (r.status === 'announced' || now - r.updatedAt.getTime() > 24 * 3600_000),
      )) {
        try {
          await this.bundles.fetch(release.version, SYSTEM);
          actions.push(`imported ${release.version}`);
        } catch (error) {
          actions.push(`download of ${release.version} failed`);
          this.logger.warn(`Bundle ${release.version}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    if (updates.policy !== 'auto-patch') return actions;

    const rollouts = this.dataSource.getRepository(RolloutEntity);

    if (await rollouts.findOne({ where: { status: In([...ACTIVE_ROLLOUT_STATUSES, 'planned']) } })) return actions;

    const target = (await this.releases.availableNewer(updates.channel)).pop();

    if (target && current) {
      const kind = updateKind(current, target.version);

      // Patch releases apply on their own (in windows); minor / major ones wait for an approval.
      await this.rollouts.create({ version: target.version, host: false }, SYSTEM, kind === 'patch');
      actions.push(`${kind === 'patch' ? 'started' : 'planned'} ${target.version}`);

      return actions;
    }

    const windows = await this.dataSource.getRepository(ResourceEntity).count({ where: { kind: 'MaintenanceWindow' } });
    const recentOs = await rollouts.findOne({
      where: {
        kind: 'os',
        status: In(['completed', 'running']),
        createdAt: MoreThan(new Date(now - OS_UPDATE_INTERVAL_MS)),
      },
    });

    if (updates.osUpdates && windows > 0 && !recentOs && current) {
      await this.rollouts.create({ host: true, osUpgrade: true }, SYSTEM, true);
      actions.push(`os updates on ${current}`);
    }

    return actions;
  }
}
