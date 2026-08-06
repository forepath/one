import type { MeterAggregator } from '../entities/meter.entity';
import type { UsageAttachmentType } from '../entities/usage-record.entity';

export type MeterUsageEntry = {
  id: string;
  meterId: string | null | undefined;
  value: string | number | null | undefined;
  attachmentType: UsageAttachmentType | null | undefined;
  addonId?: string | null;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
};

export function resolveEffectiveUnitPriceNet(
  overrideUnitPriceNet: string | number | null | undefined,
  defaultUnitPriceNet: string | number,
): number {
  const override = parseNumeric(overrideUnitPriceNet);

  if (override !== null) {
    return override;
  }

  return parseNumeric(defaultUnitPriceNet) ?? 0;
}

/**
 * Assigns each usage record to exactly one charge period by `periodEnd`.
 * Spanning intervals must not bill in both adjacent periods (avoids double charges).
 * Windows are left-open on the start (`periodEnd > periodStart`) so a sample ending
 * exactly on a boundary settles only into the period that ends there.
 */
export function isUsageInChargeWindow(entry: MeterUsageEntry, periodStart: Date, periodEnd: Date): boolean {
  const end = entry.periodEnd.getTime();
  const windowStart = periodStart.getTime();
  const windowEnd = periodEnd.getTime();

  return end > windowStart && end <= windowEnd;
}

export function filterEntriesForAttachment(
  entries: MeterUsageEntry[],
  options: {
    meterId: string;
    attachmentType: UsageAttachmentType;
    addonId?: string | null;
    periodStart: Date;
    periodEnd: Date;
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

    return isUsageInChargeWindow(entry, options.periodStart, options.periodEnd);
  });
}

export function aggregateMeterValues(entries: MeterUsageEntry[], aggregator: MeterAggregator): number {
  if (entries.length === 0) {
    return 0;
  }

  const sorted = [...entries].sort((a, b) => {
    const byCreated = a.createdAt.getTime() - b.createdAt.getTime();

    if (byCreated !== 0) {
      return byCreated;
    }

    return a.id.localeCompare(b.id);
  });

  const values = sorted.map((entry) => parseNumeric(entry.value)).filter((value): value is number => value !== null);

  if (values.length === 0) {
    return 0;
  }

  switch (aggregator) {
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    case 'avg':
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case 'first':
      return values[0] ?? 0;
    case 'last':
      return values[values.length - 1] ?? 0;
    case 'sum':
      return values.reduce((sum, value) => sum + value, 0);
    case 'sum_positive_deltas':
      return sumPositiveDeltas(values);
    default:
      return 0;
  }
}

/**
 * Sum increases between consecutive samples. On counter reset (value decreases),
 * treat the new value as a fresh series start and add it (Prometheus-style).
 */
function sumPositiveDeltas(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  if (values.length === 1) {
    return values[0] ?? 0;
  }

  let total = 0;

  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1] ?? 0;
    const current = values[index] ?? 0;

    if (current >= previous) {
      total += current - previous;
    } else {
      total += current;
    }
  }

  return total;
}

export function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
