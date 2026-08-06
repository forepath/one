import { Injectable } from '@nestjs/common';

import type { SubscriptionMeterSummaryDto } from '../dto/meter-response.dto';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { AddonMetersRepository } from '../repositories/addon-meters.repository';
import { ServicePlanMetersRepository } from '../repositories/service-plan-meters.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypeMetersRepository } from '../repositories/service-type-meters.repository';
import { SubscriptionAddonsRepository } from '../repositories/subscription-addons.repository';
import { UsageRecordsRepository } from '../repositories/usage-records.repository';
import {
  aggregateMeterValues,
  filterEntriesForAttachment,
  resolveEffectiveUnitPriceNet,
  type MeterUsageEntry,
} from '../utils/meter-aggregation.util';

export type MeterChargeLine = {
  description: string;
  quantity: number;
  unitPriceNet: number;
  meterId: string;
  attachmentType: 'plan' | 'addon';
  addonId?: string | null;
  aggregatedValue: number;
  effectiveUnitPriceNet: number;
};

const MIN_BILLABLE_AMOUNT = 0.01;

type EffectivePlanMeterLink = {
  meterId: string;
  unitPriceNet?: string | null;
  meter?: {
    id: string;
    key: string;
    name: string;
    unitLabel?: string | null;
    aggregator: import('../entities/meter.entity').MeterAggregator;
    defaultUnitPriceNet: string;
    isActive: boolean;
  };
};

@Injectable()
export class MeterBillingService {
  constructor(
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly servicePlanMetersRepository: ServicePlanMetersRepository,
    private readonly serviceTypeMetersRepository: ServiceTypeMetersRepository,
    private readonly addonMetersRepository: AddonMetersRepository,
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
    private readonly usageRecordsRepository: UsageRecordsRepository,
  ) {}

  private async resolveServiceTypeIdForPlan(planId: string, known?: string | null): Promise<string | null> {
    if (known !== undefined) {
      return known ?? null;
    }

    const plan = await this.servicePlansRepository.findById(planId);

    return plan?.serviceTypeId ?? null;
  }

  private async resolveEffectivePlanMeterLinks(
    planId: string,
    serviceTypeId?: string | null,
  ): Promise<EffectivePlanMeterLink[]> {
    const resolvedTypeId = await this.resolveServiceTypeIdForPlan(planId, serviceTypeId);
    const planLinks = await this.servicePlanMetersRepository.findByPlanId(planId);
    const byMeterId = new Map<string, EffectivePlanMeterLink>();

    for (const link of planLinks) {
      byMeterId.set(link.meterId, link);
    }

    if (resolvedTypeId) {
      const typeLinks = await this.serviceTypeMetersRepository.findByServiceTypeId(resolvedTypeId);

      for (const link of typeLinks) {
        if (!byMeterId.has(link.meterId)) {
          byMeterId.set(link.meterId, link);
        }
      }
    }

    return Array.from(byMeterId.values());
  }

  async hasAnyMeterAttachments(subscription: SubscriptionEntity, serviceTypeId?: string | null): Promise<boolean> {
    const planMeters = await this.resolveEffectivePlanMeterLinks(subscription.planId, serviceTypeId);

    if (planMeters.length > 0) {
      return true;
    }

    const billableAddons = await this.subscriptionAddonsRepository.findBillableBySubscriptionId(subscription.id);

    if (billableAddons.length === 0) {
      return false;
    }

    const addonMeters = await this.addonMetersRepository.findByAddonIds(billableAddons.map((row) => row.addonId));

    return addonMeters.length > 0;
  }

  async buildMeterChargeLines(params: {
    subscription: SubscriptionEntity;
    plan: ServicePlanEntity;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<MeterChargeLine[]> {
    if (params.plan.billInAdvance === true) {
      return [];
    }

    const usageRows = await this.usageRecordsRepository.findMeteredForSubscription(params.subscription.id);
    const entries: MeterUsageEntry[] = usageRows.map((row) => ({
      id: row.id,
      meterId: row.meterId,
      value: row.value,
      attachmentType: row.attachmentType,
      addonId: row.addonId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      createdAt: row.createdAt,
    }));

    const lines: MeterChargeLine[] = [];
    const planMeters = await this.resolveEffectivePlanMeterLinks(params.subscription.planId, params.plan.serviceTypeId);

    for (const link of planMeters) {
      const meter = link.meter;

      if (!meter || !meter.isActive) {
        continue;
      }

      const matching = filterEntriesForAttachment(entries, {
        meterId: meter.id,
        attachmentType: 'plan',
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
      });
      const aggregatedValue = aggregateMeterValues(matching, meter.aggregator);
      const effectiveUnitPriceNet = resolveEffectiveUnitPriceNet(link.unitPriceNet, meter.defaultUnitPriceNet);
      const unitPriceNet = Math.round(aggregatedValue * effectiveUnitPriceNet * 100) / 100;

      if (unitPriceNet < MIN_BILLABLE_AMOUNT) {
        continue;
      }

      const unitSuffix = meter.unitLabel ? ` (${meter.unitLabel})` : '';

      lines.push({
        description: `Usage: ${meter.name}${unitSuffix}`,
        quantity: 1,
        unitPriceNet,
        meterId: meter.id,
        attachmentType: 'plan',
        addonId: null,
        aggregatedValue,
        effectiveUnitPriceNet,
      });
    }

    const billableAddons = await this.subscriptionAddonsRepository.findBillableBySubscriptionId(params.subscription.id);
    const addonMeterLinks = await this.addonMetersRepository.findByAddonIds(billableAddons.map((row) => row.addonId));
    const linksByAddon = new Map<string, typeof addonMeterLinks>();

    for (const link of addonMeterLinks) {
      const list = linksByAddon.get(link.addonId) ?? [];
      list.push(link);
      linksByAddon.set(link.addonId, list);
    }

    for (const subscriptionAddon of billableAddons) {
      const links = linksByAddon.get(subscriptionAddon.addonId) ?? [];

      for (const link of links) {
        const meter = link.meter;

        if (!meter || !meter.isActive) {
          continue;
        }

        const matching = filterEntriesForAttachment(entries, {
          meterId: meter.id,
          attachmentType: 'addon',
          addonId: subscriptionAddon.addonId,
          periodStart: params.periodStart,
          periodEnd: params.periodEnd,
        });
        const aggregatedValue = aggregateMeterValues(matching, meter.aggregator);
        const effectiveUnitPriceNet = resolveEffectiveUnitPriceNet(link.unitPriceNet, meter.defaultUnitPriceNet);
        const unitPriceNet = Math.round(aggregatedValue * effectiveUnitPriceNet * 100) / 100;

        if (unitPriceNet < MIN_BILLABLE_AMOUNT) {
          continue;
        }

        const unitSuffix = meter.unitLabel ? ` (${meter.unitLabel})` : '';
        const addonLabel = subscriptionAddon.addonNameSnapshot || 'Addon';

        lines.push({
          description: `Usage: ${meter.name}${unitSuffix} — ${addonLabel}`,
          quantity: 1,
          unitPriceNet,
          meterId: meter.id,
          attachmentType: 'addon',
          addonId: subscriptionAddon.addonId,
          aggregatedValue,
          effectiveUnitPriceNet,
        });
      }
    }

    return lines;
  }

  async buildSubscriptionMeterSummaries(params: {
    subscription: SubscriptionEntity;
    periodStart?: Date | null;
    periodEnd?: Date | null;
  }): Promise<SubscriptionMeterSummaryDto[]> {
    const periodStart = params.periodStart ?? params.subscription.currentPeriodStart ?? params.subscription.createdAt;
    const periodEnd = params.periodEnd ?? params.subscription.currentPeriodEnd ?? new Date();
    const usageRows = await this.usageRecordsRepository.findMeteredForSubscription(params.subscription.id);
    const entries: MeterUsageEntry[] = usageRows.map((row) => ({
      id: row.id,
      meterId: row.meterId,
      value: row.value,
      attachmentType: row.attachmentType,
      addonId: row.addonId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      createdAt: row.createdAt,
    }));

    const summaries: SubscriptionMeterSummaryDto[] = [];
    const planMeters = await this.resolveEffectivePlanMeterLinks(params.subscription.planId);

    for (const link of planMeters) {
      const meter = link.meter;

      if (!meter) {
        continue;
      }

      const matching = filterEntriesForAttachment(entries, {
        meterId: meter.id,
        attachmentType: 'plan',
        periodStart,
        periodEnd,
      });
      const aggregatedValue = aggregateMeterValues(matching, meter.aggregator);
      const effectiveUnitPriceNet = resolveEffectiveUnitPriceNet(link.unitPriceNet, meter.defaultUnitPriceNet);

      summaries.push({
        meterId: meter.id,
        key: meter.key,
        name: meter.name,
        unitLabel: meter.unitLabel ?? null,
        aggregator: meter.aggregator,
        attachmentType: 'plan',
        addonId: null,
        addonName: null,
        effectiveUnitPriceNet,
        aggregatedValue,
        estimatedChargeNet: Math.round(aggregatedValue * effectiveUnitPriceNet * 100) / 100,
        entryCount: matching.length,
        periodStart,
        periodEnd,
      });
    }

    const billableAddons = await this.subscriptionAddonsRepository.findBillableBySubscriptionId(params.subscription.id);
    const addonMeterLinks = await this.addonMetersRepository.findByAddonIds(billableAddons.map((row) => row.addonId));
    const linksByAddon = new Map<string, typeof addonMeterLinks>();

    for (const link of addonMeterLinks) {
      const list = linksByAddon.get(link.addonId) ?? [];
      list.push(link);
      linksByAddon.set(link.addonId, list);
    }

    for (const subscriptionAddon of billableAddons) {
      const links = linksByAddon.get(subscriptionAddon.addonId) ?? [];

      for (const link of links) {
        const meter = link.meter;

        if (!meter) {
          continue;
        }

        const matching = filterEntriesForAttachment(entries, {
          meterId: meter.id,
          attachmentType: 'addon',
          addonId: subscriptionAddon.addonId,
          periodStart,
          periodEnd,
        });
        const aggregatedValue = aggregateMeterValues(matching, meter.aggregator);
        const effectiveUnitPriceNet = resolveEffectiveUnitPriceNet(link.unitPriceNet, meter.defaultUnitPriceNet);

        summaries.push({
          meterId: meter.id,
          key: meter.key,
          name: meter.name,
          unitLabel: meter.unitLabel ?? null,
          aggregator: meter.aggregator,
          attachmentType: 'addon',
          addonId: subscriptionAddon.addonId,
          addonName: subscriptionAddon.addonNameSnapshot,
          effectiveUnitPriceNet,
          aggregatedValue,
          estimatedChargeNet: Math.round(aggregatedValue * effectiveUnitPriceNet * 100) / 100,
          entryCount: matching.length,
          periodStart,
          periodEnd,
        });
      }
    }

    return summaries;
  }
}
