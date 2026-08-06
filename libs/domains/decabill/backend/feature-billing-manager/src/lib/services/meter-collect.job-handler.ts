import { runWithTenantId } from '@forepath/shared/backend';
import { Injectable, Logger } from '@nestjs/common';

import type { DeclaredMeterDefinition } from '../dto/declared-meter.dto';
import { METER_COLLECT_USAGE_SOURCE, type MeterCollectSample } from '../dto/meter-collect.types';
import type { UsageAttachmentType } from '../entities/usage-record.entity';
import { AddonsRepository } from '../repositories/addons.repository';
import { AddonMetersRepository } from '../repositories/addon-meters.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionAddonsRepository } from '../repositories/subscription-addons.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { UsageRecordsRepository } from '../repositories/usage-records.repository';

import { AddonModuleRegistryService } from './addon-module-registry.service';
import { MeterService } from './meter.service';
import { ProviderModuleRegistryService } from './provider-module-registry.service';
import { ProviderRegistryService } from './provider-registry.service';
import { UsageService } from './usage.service';

interface DueMeterWindow {
  meterKey: string;
  meterId: string;
  intervalMs: number;
  periodStart: Date;
  periodEnd: Date;
}

@Injectable()
export class MeterCollectJobHandler {
  private readonly logger = new Logger(MeterCollectJobHandler.name);
  private readonly batchSize = parseInt(process.env.BILLING_METER_COLLECT_BATCH_SIZE ?? '500', 10);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
    private readonly addonsRepository: AddonsRepository,
    private readonly addonMetersRepository: AddonMetersRepository,
    private readonly usageRecordsRepository: UsageRecordsRepository,
    private readonly meterService: MeterService,
    private readonly usageService: UsageService,
    private readonly providerModuleRegistry: ProviderModuleRegistryService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly addonModuleRegistry: AddonModuleRegistryService,
  ) {}

  async processTenant(tenantId: string, now: Date = new Date()): Promise<void> {
    await runWithTenantId(tenantId, async () => {
      let offset = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const subscriptions = await this.subscriptionsRepository.findActiveArrearForMeterCollect(
          this.batchSize,
          offset,
        );

        if (subscriptions.length === 0) {
          break;
        }

        for (const subscription of subscriptions) {
          try {
            await this.collectForSubscription(subscription, now);
          } catch (error) {
            this.logger.warn(
              `Meter collect failed for subscription ${subscription.id}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }

        if (subscriptions.length < this.batchSize) {
          break;
        }

        offset += subscriptions.length;
      }
    });
  }

  private async collectForSubscription(
    subscription: { id: string; planId: string; nextBillingAt?: Date | null; currentPeriodEnd?: Date | null },
    now: Date,
  ): Promise<void> {
    const chargePeriodEnd = subscription.nextBillingAt ?? subscription.currentPeriodEnd ?? null;

    await this.collectPlanMeters(subscription.id, subscription.planId, now, chargePeriodEnd);
    await this.collectAddonMeters(subscription.id, now, chargePeriodEnd);
  }

  private async collectPlanMeters(
    subscriptionId: string,
    planId: string,
    now: Date,
    chargePeriodEnd: Date | null,
  ): Promise<void> {
    const items = await this.subscriptionItemsRepository.findBySubscription(subscriptionId);
    const item = items.find((row) => row.providerReference?.trim());

    if (!item?.providerReference) {
      return;
    }

    const providerId = item.serviceType?.provider?.trim();

    if (!providerId) {
      return;
    }

    const declaredByKey = this.resolveProviderDeclaredMeters(providerId);

    if (declaredByKey.size === 0) {
      return;
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(planId);
    const effective = await this.meterService.listEffectivePlanMeters(planId, plan.serviceTypeId);
    const dueWindows: DueMeterWindow[] = [];

    for (const attached of effective) {
      const declared = declaredByKey.get(attached.key);

      if (!declared?.collectionIntervalMs) {
        continue;
      }

      const window = await this.resolveDueWindow({
        subscriptionId,
        meterId: attached.meterId,
        meterKey: attached.key,
        intervalMs: declared.collectionIntervalMs,
        attachmentType: 'plan',
        addonId: null,
        now,
        chargePeriodEnd,
      });

      if (window) {
        dueWindows.push(window);
      }
    }

    if (dueWindows.length === 0) {
      return;
    }

    const providerModule = this.providerModuleRegistry.get(providerId);

    if (!providerModule?.collectMeters) {
      this.logger.warn(
        `Provider '${providerId}' has collectable meters but no collectMeters implementation; skipping subscription ${subscriptionId}`,
      );

      return;
    }

    // One collect call per due meter so sample windows match persisted periods.
    for (const window of dueWindows) {
      const samples = await providerModule.collectMeters({
        subscriptionId,
        subscriptionItemId: item.id,
        provider: providerId,
        providerReference: item.providerReference,
        hostname: item.hostname,
        meterKeys: [window.meterKey],
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
      });

      await this.persistSamples({
        subscriptionId,
        samples,
        dueWindows: [window],
        attachmentType: 'plan',
      });
    }
  }

  private async collectAddonMeters(subscriptionId: string, now: Date, chargePeriodEnd: Date | null): Promise<void> {
    const items = await this.subscriptionItemsRepository.findBySubscription(subscriptionId);
    const item = items.find((row) => row.providerReference?.trim());
    const billableAddons = await this.subscriptionAddonsRepository.findActiveBySubscriptionId(subscriptionId);

    for (const subscriptionAddon of billableAddons) {
      try {
        const addon =
          subscriptionAddon.addon ?? (await this.addonsRepository.findByIdOrThrow(subscriptionAddon.addonId));

        if (addon.implementationType !== 'module' || !addon.moduleKey?.trim()) {
          continue;
        }

        const module = this.addonModuleRegistry.get(addon.moduleKey.trim());
        const declaredByKey = new Map((module?.meters ?? []).map((def) => [def.key.trim(), def] as const));

        if (declaredByKey.size === 0) {
          continue;
        }

        const links = await this.addonMetersRepository.findByAddonId(addon.id);
        const dueWindows: DueMeterWindow[] = [];

        for (const link of links) {
          const meter = link.meter;

          if (!meter) {
            continue;
          }

          const def = declaredByKey.get(meter.key);

          if (!def?.collectionIntervalMs) {
            continue;
          }

          const window = await this.resolveDueWindow({
            subscriptionId,
            meterId: meter.id,
            meterKey: meter.key,
            intervalMs: def.collectionIntervalMs,
            attachmentType: 'addon',
            addonId: addon.id,
            now,
            chargePeriodEnd,
          });

          if (window) {
            dueWindows.push(window);
          }
        }

        if (dueWindows.length === 0) {
          continue;
        }

        if (!module?.collectMeters) {
          this.logger.warn(
            `Addon module '${addon.moduleKey}' has collectable meters but no collectMeters; skipping addon ${addon.id} on ${subscriptionId}`,
          );
          continue;
        }

        const providerId = item?.serviceType?.provider ?? '';

        for (const window of dueWindows) {
          const samples = await module.collectMeters({
            subscriptionId,
            subscriptionItemId: item?.id,
            provider: providerId,
            providerReference: item?.providerReference,
            addonId: addon.id,
            addonKey: addon.key,
            configSnapshot: subscriptionAddon.configSnapshot,
            hostname: item?.hostname,
            meterKeys: [window.meterKey],
            periodStart: window.periodStart,
            periodEnd: window.periodEnd,
          });

          await this.persistSamples({
            subscriptionId,
            samples,
            dueWindows: [window],
            attachmentType: 'addon',
            addonId: addon.id,
          });
        }
      } catch (error) {
        this.logger.warn(
          `Meter collect failed for subscription addon ${subscriptionAddon.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private resolveProviderDeclaredMeters(providerId: string): Map<string, DeclaredMeterDefinition> {
    const byKey = new Map<string, DeclaredMeterDefinition>();
    const metadata = this.providerRegistry.getProvider(providerId);
    const runtime = this.providerModuleRegistry.get(providerId);

    for (const def of metadata?.meters ?? []) {
      byKey.set(def.key.trim(), def);
    }

    for (const def of runtime?.meters ?? []) {
      byKey.set(def.key.trim(), def);
    }

    return byKey;
  }

  private async resolveDueWindow(params: {
    subscriptionId: string;
    meterId: string;
    meterKey: string;
    intervalMs: number;
    attachmentType: UsageAttachmentType;
    addonId: string | null;
    now: Date;
    chargePeriodEnd: Date | null;
  }): Promise<DueMeterWindow | null> {
    const last = await this.usageRecordsRepository.findLatestCollectorForMeter({
      subscriptionId: params.subscriptionId,
      meterId: params.meterId,
      attachmentType: params.attachmentType,
      addonId: params.addonId,
    });

    if (last?.periodEnd) {
      const elapsed = params.now.getTime() - new Date(last.periodEnd).getTime();

      if (elapsed < params.intervalMs) {
        return null;
      }
    }

    // Settle into the open charge window when collect runs after nextBillingAt but before the billing tick.
    const periodEnd =
      params.chargePeriodEnd && params.now.getTime() > params.chargePeriodEnd.getTime()
        ? new Date(params.chargePeriodEnd)
        : params.now;
    const periodStart = last?.periodEnd ? new Date(last.periodEnd) : new Date(periodEnd.getTime() - params.intervalMs);

    if (periodStart.getTime() >= periodEnd.getTime()) {
      return null;
    }

    return {
      meterKey: params.meterKey,
      meterId: params.meterId,
      intervalMs: params.intervalMs,
      periodStart,
      periodEnd,
    };
  }

  private async persistSamples(params: {
    subscriptionId: string;
    samples: MeterCollectSample[];
    dueWindows: DueMeterWindow[];
    attachmentType: UsageAttachmentType;
    addonId?: string;
  }): Promise<void> {
    const dueByKey = new Map(params.dueWindows.map((row) => [row.meterKey, row]));

    for (const sample of params.samples) {
      const due = dueByKey.get(sample.meterKey.trim());

      if (!due) {
        this.logger.debug(
          `Ignoring collector sample for unexpected meter key '${sample.meterKey}' on subscription ${params.subscriptionId}`,
        );
        continue;
      }

      if (!Number.isFinite(sample.value) || sample.value < 0) {
        this.logger.warn(
          `Collector sample for meter '${sample.meterKey}' on subscription ${params.subscriptionId} is invalid; skipping`,
        );
        continue;
      }

      await this.usageService.createUsage({
        subscriptionId: params.subscriptionId,
        periodStart: due.periodStart,
        periodEnd: due.periodEnd,
        usageSource: METER_COLLECT_USAGE_SOURCE,
        usagePayload: sample.usagePayload ?? {},
        meterId: due.meterId,
        value: sample.value,
        attachmentType: params.attachmentType,
        addonId: params.addonId,
      });
    }
  }
}
