import { Injectable } from '@nestjs/common';

import type { MeterHistorySeriesDto, SubscriptionMeterHistoryDto } from '../dto/meter-history.dto';
import type { SubscriptionMeterSummaryDto } from '../dto/meter-response.dto';
import type { MeterAggregator } from '../entities/meter.entity';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import type { UsageAttachmentType } from '../entities/usage-record.entity';
import { AddonMetersRepository } from '../repositories/addon-meters.repository';
import { ServicePlanMetersRepository } from '../repositories/service-plan-meters.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypeMetersRepository } from '../repositories/service-type-meters.repository';
import { SubscriptionAddonsRepository } from '../repositories/subscription-addons.repository';
import { UsageRecordsRepository } from '../repositories/usage-records.repository';
import {
  aggregateMeterValues,
  computeBillableMeterValue,
  filterEntriesForAttachment,
  resolveEffectiveIncludedUsage,
  resolveEffectiveUnitPriceNet,
  type MeterUsageEntry,
} from '../utils/meter-aggregation.util';
import { formatMeterHistoryPeriodBucket, fillMeterHistoryPeriodSeries } from '../utils/meter-history-date.util';

export type MeterChargeLine = {
  description: string;
  quantity: number;
  unitPriceNet: number;
  meterId: string;
  attachmentType: 'plan' | 'addon';
  addonId?: string | null;
  aggregatedValue: number;
  billableValue: number;
  effectiveIncludedUsage: number;
  effectiveUnitPriceNet: number;
};

const MIN_BILLABLE_AMOUNT = 0.01;

type EffectivePlanMeterLink = {
  meterId: string;
  unitPriceNet?: string | null;
  includedUsage?: string | null;
  meter?: {
    id: string;
    key: string;
    name: string;
    unitLabel?: string | null;
    aggregator: import('../entities/meter.entity').MeterAggregator;
    defaultUnitPriceNet: string;
    defaultIncludedUsage?: string;
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
      const effectiveIncludedUsage = resolveEffectiveIncludedUsage(link.includedUsage, meter.defaultIncludedUsage ?? 0);
      const billableValue = computeBillableMeterValue(aggregatedValue, effectiveIncludedUsage);
      const unitPriceNet = Math.round(billableValue * effectiveUnitPriceNet * 100) / 100;

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
        billableValue,
        effectiveIncludedUsage,
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
        const effectiveIncludedUsage = resolveEffectiveIncludedUsage(
          link.includedUsage,
          meter.defaultIncludedUsage ?? 0,
        );
        const billableValue = computeBillableMeterValue(aggregatedValue, effectiveIncludedUsage);
        const unitPriceNet = Math.round(billableValue * effectiveUnitPriceNet * 100) / 100;

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
          billableValue,
          effectiveIncludedUsage,
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
      const effectiveIncludedUsage = resolveEffectiveIncludedUsage(link.includedUsage, meter.defaultIncludedUsage ?? 0);
      const billableValue = computeBillableMeterValue(aggregatedValue, effectiveIncludedUsage);

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
        effectiveIncludedUsage,
        aggregatedValue,
        billableValue,
        estimatedChargeNet: Math.round(billableValue * effectiveUnitPriceNet * 100) / 100,
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
        const effectiveIncludedUsage = resolveEffectiveIncludedUsage(
          link.includedUsage,
          meter.defaultIncludedUsage ?? 0,
        );
        const billableValue = computeBillableMeterValue(aggregatedValue, effectiveIncludedUsage);

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
          effectiveIncludedUsage,
          aggregatedValue,
          billableValue,
          estimatedChargeNet: Math.round(billableValue * effectiveUnitPriceNet * 100) / 100,
          entryCount: matching.length,
          periodStart,
          periodEnd,
        });
      }
    }

    return summaries;
  }

  async buildSubscriptionMeterHistory(params: {
    subscription: SubscriptionEntity;
    from: Date;
    to: Date;
    groupBy: 'day' | 'month';
  }): Promise<SubscriptionMeterHistoryDto> {
    const usageRows = await this.usageRecordsRepository.findMeteredForSubscriptionInRange(
      params.subscription.id,
      params.from,
      params.to,
    );
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
    const meters: MeterHistorySeriesDto[] = [];
    const planMeters = await this.resolveEffectivePlanMeterLinks(params.subscription.planId);

    for (const link of planMeters) {
      const meter = link.meter;

      if (!meter) {
        continue;
      }

      meters.push(
        this.buildMeterHistorySeries({
          meter: {
            id: meter.id,
            key: meter.key,
            name: meter.name,
            unitLabel: meter.unitLabel ?? null,
            aggregator: meter.aggregator,
          },
          attachmentType: 'plan',
          addonId: null,
          addonName: null,
          entries,
          groupBy: params.groupBy,
          from: params.from,
          to: params.to,
        }),
      );
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

        meters.push(
          this.buildMeterHistorySeries({
            meter: {
              id: meter.id,
              key: meter.key,
              name: meter.name,
              unitLabel: meter.unitLabel ?? null,
              aggregator: meter.aggregator,
            },
            attachmentType: 'addon',
            addonId: subscriptionAddon.addonId,
            addonName: subscriptionAddon.addonNameSnapshot,
            entries,
            groupBy: params.groupBy,
            from: params.from,
            to: params.to,
          }),
        );
      }
    }

    return {
      subscriptionId: params.subscription.id,
      from: params.from.toISOString().slice(0, 10),
      to: params.to.toISOString().slice(0, 10),
      groupBy: params.groupBy,
      meters,
    };
  }

  private buildMeterHistorySeries(params: {
    meter: {
      id: string;
      key: string;
      name: string;
      unitLabel: string | null;
      aggregator: MeterAggregator;
    };
    attachmentType: UsageAttachmentType;
    addonId: string | null;
    addonName: string | null;
    entries: MeterUsageEntry[];
    groupBy: 'day' | 'month';
    from: Date;
    to: Date;
  }): MeterHistorySeriesDto {
    const matching = this.filterEntriesForMeterAttachment(params.entries, {
      meterId: params.meter.id,
      attachmentType: params.attachmentType,
      addonId: params.addonId,
    });
    const buckets = new Map<string, MeterUsageEntry[]>();

    for (const entry of matching) {
      const period = formatMeterHistoryPeriodBucket(entry.periodEnd, params.groupBy);
      const bucket = buckets.get(period) ?? [];

      bucket.push(entry);
      buckets.set(period, bucket);
    }

    const sparseSeries = Array.from(buckets.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([period, bucketEntries]) => ({
        period,
        value: aggregateMeterValues(bucketEntries, params.meter.aggregator),
      }));
    const from = params.from.toISOString().slice(0, 10);
    const to = params.to.toISOString().slice(0, 10);
    const series = fillMeterHistoryPeriodSeries(sparseSeries, from, to, params.groupBy, (period) => ({
      period,
      value: 0,
    }));

    return {
      meterId: params.meter.id,
      key: params.meter.key,
      name: params.meter.name,
      unitLabel: params.meter.unitLabel,
      aggregator: params.meter.aggregator,
      attachmentType: params.attachmentType,
      addonId: params.addonId,
      addonName: params.addonName,
      series,
      totalValue: aggregateMeterValues(matching, params.meter.aggregator),
    };
  }

  private filterEntriesForMeterAttachment(
    entries: MeterUsageEntry[],
    options: {
      meterId: string;
      attachmentType: UsageAttachmentType;
      addonId?: string | null;
    },
  ): MeterUsageEntry[] {
    return entries.filter((entry) => {
      if (entry.meterId !== options.meterId) {
        return false;
      }

      if ((entry.attachmentType ?? 'plan') !== options.attachmentType) {
        return false;
      }

      if (options.attachmentType === 'addon') {
        if (!options.addonId || entry.addonId !== options.addonId) {
          return false;
        }
      }

      return true;
    });
  }
}
