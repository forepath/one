/** Context passed to provider / addon module collectMeters implementations. */
export interface MeterCollectContext {
  subscriptionId: string;
  subscriptionItemId?: string;
  provider: string;
  providerReference?: string;
  addonId?: string;
  addonKey?: string;
  configSnapshot?: Record<string, unknown>;
  hostname?: string;
  meterKeys: string[];
  periodStart: Date;
  periodEnd: Date;
}

/** One sample returned by collectMeters for a declared meter key. */
export interface MeterCollectSample {
  meterKey: string;
  value: number;
  usagePayload?: Record<string, unknown>;
}

/** usage_source value written by the meter-collect job. */
export const METER_COLLECT_USAGE_SOURCE = 'collector' as const;
