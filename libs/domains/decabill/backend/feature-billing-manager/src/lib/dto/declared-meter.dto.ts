import { BadRequestException } from '@nestjs/common';

import type { MeterAggregator } from '../entities/meter.entity';

/** Meter declared by a provider package or addon module implementation. */
export interface DeclaredMeterDefinition {
  key: string;
  name: string;
  description?: string;
  unitLabel?: string;
  aggregator: MeterAggregator;
  defaultUnitPriceNet: number;
  /**
   * When set (> 0), the meter-collect job pulls samples on this interval.
   * Omitted meters stay push-only (admin / API key recording).
   */
  collectionIntervalMs?: number;
}

/** Validates optional collectionIntervalMs on a declared meter definition. */
export function assertDeclaredMeterCollectionInterval(def: DeclaredMeterDefinition): void {
  if (def.collectionIntervalMs === undefined || def.collectionIntervalMs === null) {
    return;
  }

  if (!Number.isFinite(def.collectionIntervalMs) || def.collectionIntervalMs <= 0) {
    throw new BadRequestException(
      `Declared meter '${def.key}' collectionIntervalMs must be a positive number when set`,
    );
  }
}
