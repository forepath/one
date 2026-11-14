import { isIP } from 'node:net';

import { Injectable } from '@nestjs/common';

import type { SubscriptionItemEntity } from '../../../entities/subscription-item.entity';
import { ContainerStatsSamplesRepository } from '../../../repositories/container-stats-samples.repository';
import { ContainerStatsSummariesRepository } from '../../../repositories/container-stats-summaries.repository';
import { SubscriptionAddonsRepository } from '../../../repositories/subscription-addons.repository';
import { SubscriptionItemsRepository } from '../../../repositories/subscription-items.repository';
import type { ContributorJobContext } from '../../../utils/contributor-job.types';
import { CONTAINER_MANAGER_MODULE_KEY } from '../../../utils/plan-addons.utils';
import {
  CONTAINER_MANAGER_HISTORY_MAX_POINTS,
  DOCKER_CONTAINER_ID_PATTERN,
} from '../constants/container-manager.constants';
import type { ContainerManagerContainersResponseDto } from '../dto/container-manager.dto';

import { ContainerManagerService } from './container-manager.service';

const DEFAULT_SSH_CONCURRENCY = 3;
const MAX_SSH_CONCURRENCY = 16;

@Injectable()
export class ContainerManagerCollectService {
  constructor(
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
    private readonly samplesRepository: ContainerStatsSamplesRepository,
    private readonly summariesRepository: ContainerStatsSummariesRepository,
    private readonly containerManagerService: ContainerManagerService,
  ) {}

  async collectTenant(ctx: ContributorJobContext): Promise<void> {
    void ctx;
    const items = await this.subscriptionItemsRepository.findLiveProvisionedWithSshKey();
    const eligible = await this.filterEligible(items);

    await mapWithConcurrency(eligible, parseSshConcurrency(), async (item) => {
      try {
        const snapshot = await this.containerManagerService.collectLiveContainersForItem(item);

        await this.persistSnapshot(item, snapshot);
      } catch (error: unknown) {
        await this.containerManagerService.notifyCollectionFailed(item.subscriptionId, item.id, error);
      }
    });
  }

  private async filterEligible(items: SubscriptionItemEntity[]): Promise<SubscriptionItemEntity[]> {
    const addonBySubscription = new Map<string, boolean>();
    const eligible: SubscriptionItemEntity[] = [];

    for (const item of items) {
      if (!item.providerReference?.trim() || !item.sshPrivateKey) {
        continue;
      }

      if (!tryResolvePublicIp(item.serverInfoSnapshot)) {
        continue;
      }

      const hasAddon = await this.hasActiveContainerManagerAddon(item.subscriptionId, addonBySubscription);

      if (!hasAddon) {
        continue;
      }

      eligible.push(item);
    }

    return eligible;
  }

  private async hasActiveContainerManagerAddon(subscriptionId: string, cache: Map<string, boolean>): Promise<boolean> {
    const cached = cache.get(subscriptionId);

    if (cached !== undefined) {
      return cached;
    }

    const rows = await this.subscriptionAddonsRepository.findActiveBySubscriptionId(subscriptionId);
    const hasAddon = rows.some(
      (row) =>
        row.status === 'active' &&
        row.addon?.implementationType === 'module' &&
        row.addon.moduleKey === CONTAINER_MANAGER_MODULE_KEY,
    );

    cache.set(subscriptionId, hasAddon);

    return hasAddon;
  }

  private async persistSnapshot(
    item: SubscriptionItemEntity,
    snapshot: ContainerManagerContainersResponseDto,
  ): Promise<void> {
    const collectedAt = new Date(snapshot.collectedAt);
    const healthyCount = snapshot.containers.filter(
      (container) => /running/i.test(container.state) || /up /i.test(container.status),
    ).length;

    for (const container of snapshot.containers) {
      if (!DOCKER_CONTAINER_ID_PATTERN.test(container.id) || !container.stats) {
        continue;
      }

      await this.samplesRepository.insertSample({
        subscriptionId: item.subscriptionId,
        itemId: item.id,
        containerId: container.id,
        collectedAt,
        stats: {
          cpuPercent: container.stats.cpuPercent,
          memoryPercent: container.stats.memoryPercent,
          memoryUsageBytes: container.stats.memoryUsageBytes,
          memoryLimitBytes: container.stats.memoryLimitBytes,
          blockReadBytes: container.stats.blockReadBytes,
          blockWriteBytes: container.stats.blockWriteBytes,
          networkRxBytes: container.stats.networkRxBytes,
          networkTxBytes: container.stats.networkTxBytes,
        },
      });
      await this.samplesRepository.trimToMaxPoints(item.id, container.id, CONTAINER_MANAGER_HISTORY_MAX_POINTS);
    }

    await this.summariesRepository.upsertSummary({
      itemId: item.id,
      subscriptionId: item.subscriptionId,
      containerCount: snapshot.containers.length,
      healthyCount,
      lastCollectedAt: collectedAt,
    });
  }
}

function tryResolvePublicIp(snapshot: Record<string, unknown> | null | undefined): string | null {
  const ip = snapshot && typeof snapshot['publicIp'] === 'string' ? snapshot['publicIp'].trim() : '';

  if (!ip || isIP(ip) === 0) {
    return null;
  }

  return ip;
}

function parseSshConcurrency(): number {
  const raw = process.env.BILLING_CONTAINER_MANAGER_COLLECT_CONCURRENCY?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_SSH_CONCURRENCY;

  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_SSH_CONCURRENCY;
  }

  return Math.min(Math.trunc(parsed), MAX_SSH_CONCURRENCY);
}

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const current = next;

        next += 1;
        await worker(items[current]);
      }
    }),
  );
}
