import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { In, IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';

import { SubscriptionItemEntity } from '../../entities/subscription-item.entity';
import { SubscriptionEntity, SubscriptionStatus } from '../../entities/subscription.entity';
import { clampContributorJobIntervalMs, type ContributorJobDefinition } from '../../utils/contributor-job.types';

import { isLoadweaverItem } from './loadweaver.utils';

/**
 * Loadweaver Cloud teardown through the fleet service (section 4, carried from P3 to P7): Decabill holds no cluster
 * credentials, so during the grace period of a cancelled Loadweaver subscription it asks the Loadweaver fleet
 * service — with a dedicated fleet credential — to run the cluster's final backup and switch the cluster to
 * read-only access until the teardown. Only when `LOADWEAVER_FLEET_URL` and `LOADWEAVER_FLEET_TOKEN` are set;
 * otherwise nothing changes (the grace period and teardown run as before).
 *
 * The fleet call is idempotent (one final backup per teardown), so the job simply repeats it on every run while
 * the grace lasts; clusters that are not registered in the fleet are skipped.
 */
export interface LoadweaverFleetConfig {
  url: string;
  token: string;
}

export const LOADWEAVER_FLEET_TEARDOWN_JOB_KEY = 'fleet-teardown';
const DEFAULT_INTERVAL_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Page size of the grace query; pages are walked in id order (keyset), so every subscription is reached each run. */
export const LOADWEAVER_FLEET_TEARDOWN_PAGE_SIZE = 500;

/** The fleet connection from the environment, or null when not configured / not safe. */
export function resolveLoadweaverFleetConfig(env: NodeJS.ProcessEnv = process.env): LoadweaverFleetConfig | null {
  const rawUrl = env['LOADWEAVER_FLEET_URL']?.trim();
  const token = env['LOADWEAVER_FLEET_TOKEN']?.trim();

  if (!rawUrl || !token) return null;

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const insecureAllowed =
    env['LOADWEAVER_FLEET_ALLOW_INSECURE_HTTP']?.trim().toLowerCase() === 'true' && env['NODE_ENV'] !== 'production';

  if (url.username || url.password || url.search || url.hash) return null;

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && insecureAllowed)) return null;

  return { url: `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '').replace(/\/api$/, '')}`, token };
}

export function loadweaverFleetSyncIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env['LOADWEAVER_FLEET_SYNC_INTERVAL_MS'] ?? '', 10);

  return clampContributorJobIntervalMs(Number.isFinite(parsed) ? parsed : DEFAULT_INTERVAL_MS);
}

/** Fleet reference of a Decabill-provisioned cluster (registered with it, see docs/loadweaver/features/fleet.md). */
export function loadweaverFleetReference(subscriptionId: string, itemId: string): string {
  return `decabill:${subscriptionId}:${itemId}`;
}

export interface FleetTeardownResult {
  notified: string[];
  notRegistered: string[];
  failed: string[];
}

@Injectable()
export class LoadweaverFleetTeardownService {
  private readonly logger = new Logger(LoadweaverFleetTeardownService.name);

  constructor(
    @InjectRepository(SubscriptionEntity) private readonly subscriptions: Repository<SubscriptionEntity>,
    @InjectRepository(SubscriptionItemEntity) private readonly items: Repository<SubscriptionItemEntity>,
  ) {}

  /** Contributor job of the `loadweaver` integrated stack (registered by the contributor module). */
  jobDefinition(): ContributorJobDefinition {
    return {
      key: LOADWEAVER_FLEET_TEARDOWN_JOB_KEY,
      intervalMs: loadweaverFleetSyncIntervalMs(),
      isEnabled: () => resolveLoadweaverFleetConfig() !== null,
      run: async (ctx) => {
        await this.sync(ctx.now);
      },
    };
  }

  /**
   * One page of subscriptions in their grace period: teardown still ahead (`teardownNotBefore`) and the cancellation
   * effective (withdrawals / instant cancels have no `cancelEffectiveAt` and are in grace right away). Ordered by id
   * and continued after `afterId` (keyset paging), so a backlog larger than one page never starves the tail.
   */
  async inGrace(
    now: Date,
    afterId: string | null = null,
    take = LOADWEAVER_FLEET_TEARDOWN_PAGE_SIZE,
  ): Promise<SubscriptionEntity[]> {
    const base = {
      status: In([
        SubscriptionStatus.PENDING_CANCEL,
        SubscriptionStatus.PENDING_WITHDRAWAL,
        SubscriptionStatus.PENDING_INSTANT_CANCEL,
      ]),
      teardownNotBefore: MoreThan(now),
      ...(afterId ? { id: MoreThan(afterId) } : {}),
    };

    return await this.subscriptions.find({
      where: [
        { ...base, cancelEffectiveAt: LessThanOrEqual(now) },
        { ...base, cancelEffectiveAt: IsNull() },
      ],
      order: { id: 'ASC' },
      take,
    });
  }

  /** Every subscription in grace, page by page. */
  private async *allInGrace(now: Date): AsyncGenerator<SubscriptionEntity> {
    let afterId: string | null = null;

    for (;;) {
      const page = await this.inGrace(now, afterId);

      for (const subscription of page) yield subscription;

      if (page.length < LOADWEAVER_FLEET_TEARDOWN_PAGE_SIZE) return;

      afterId = page[page.length - 1].id;
    }
  }

  async sync(now: Date = new Date(), config = resolveLoadweaverFleetConfig()): Promise<FleetTeardownResult> {
    const result: FleetTeardownResult = { notified: [], notRegistered: [], failed: [] };

    if (!config) return result;

    for await (const subscription of this.allInGrace(now)) {
      const items = (await this.items.find({ where: { subscriptionId: subscription.id } })) ?? [];

      for (const item of items.filter((i) => isLoadweaverItem(i))) {
        const reference = loadweaverFleetReference(subscription.id, item.id);

        try {
          const response = await axios.put(
            `${config.url}/api/cloud/clusters/${encodeURIComponent(reference)}/teardown`,
            {
              readOnlyUntil: new Date(subscription.teardownNotBefore as Date).toISOString(),
              reason: `Decabill subscription ${subscription.number} cancelled`,
              finalBackup: true,
            },
            {
              headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
              timeout: REQUEST_TIMEOUT_MS,
              maxRedirects: 0,
              validateStatus: () => true,
            },
          );

          if (response.status === 404) {
            result.notRegistered.push(reference);
          } else if (response.status >= 200 && response.status < 300) {
            result.notified.push(reference);
          } else {
            result.failed.push(reference);
            this.logger.warn(`Fleet teardown of ${reference}: HTTP ${response.status}`);
          }
        } catch (error) {
          result.failed.push(reference);
          this.logger.warn(`Fleet teardown of ${reference}: ${error instanceof Error ? error.message : error}`);
        }
      }
    }

    if (result.notified.length || result.failed.length)
      this.logger.log(
        `Loadweaver fleet teardown: ${result.notified.length} notified, ${result.notRegistered.length} not registered, ${result.failed.length} failed`,
      );

    return result;
  }
}
