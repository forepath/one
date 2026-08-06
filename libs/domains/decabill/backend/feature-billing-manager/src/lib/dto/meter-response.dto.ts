import type { MeterAggregator } from '../entities/meter.entity';
import type { UsageAttachmentType } from '../entities/usage-record.entity';

export class MeterResponseDto {
  id!: string;
  key!: string;
  name!: string;
  description?: string | null;
  unitLabel?: string | null;
  aggregator!: MeterAggregator;
  defaultUnitPriceNet!: number;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export class AttachedMeterResponseDto {
  meterId!: string;
  key!: string;
  name!: string;
  description?: string | null;
  unitLabel?: string | null;
  aggregator!: MeterAggregator;
  defaultUnitPriceNet!: number;
  unitPriceNetOverride?: number | null;
  effectiveUnitPriceNet!: number;
  isActive!: boolean;
  source!: 'manual' | 'module' | 'provider';
  required!: boolean;
  /** True when the meter comes from the plan's service type (not a direct plan link). */
  inherited?: boolean;
}

export class SubscriptionMeterSummaryDto {
  meterId!: string;
  key!: string;
  name!: string;
  unitLabel?: string | null;
  aggregator!: MeterAggregator;
  attachmentType!: UsageAttachmentType;
  addonId?: string | null;
  addonName?: string | null;
  effectiveUnitPriceNet!: number;
  aggregatedValue!: number;
  estimatedChargeNet!: number;
  entryCount!: number;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

export class UsageMeterEntryResponseDto {
  id!: string;
  subscriptionId!: string;
  meterId!: string;
  value!: number;
  attachmentType!: UsageAttachmentType;
  addonId?: string | null;
  periodStart!: Date;
  periodEnd!: Date;
  usageSource!: string;
  usagePayload!: Record<string, unknown>;
  createdAt!: Date;
}
