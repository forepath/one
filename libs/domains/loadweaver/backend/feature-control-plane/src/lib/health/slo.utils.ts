/** One objective's state over its window (3.25): SLI, error budget, and how fast it burns. */
export interface ObjectiveStatus {
  /** Target in percent (e.g. 99.9). */
  target: number;
  /** Measured share of good events in percent; null without traffic. */
  sli: number | null;
  /** The error budget in percent of events (100 − target). */
  budget: number;
  /** Share of the budget used so far (0 = untouched, 1 = exhausted, can exceed 1). */
  consumed: number;
  /** Error rate of the last hour relative to the budget (1 = burning exactly at the sustainable rate). */
  burnRate1h: number | null;
  state: 'ok' | 'burning' | 'exhausted' | 'no-data';
}

/** Google's fast-burn threshold: 2 % of a 30-day budget in one hour. */
export const FAST_BURN = 14.4;

export function objectiveStatus(
  target: number,
  window: { good: number; total: number },
  lastHour: { good: number; total: number },
): ObjectiveStatus {
  const budget = 100 - target;

  if (window.total <= 0) return { target, sli: null, budget, consumed: 0, burnRate1h: null, state: 'no-data' };

  const badShare = 1 - window.good / window.total;
  const consumed = budget > 0 ? (badShare * 100) / budget : badShare > 0 ? Infinity : 0;
  const burnRate1h = lastHour.total > 0 && budget > 0 ? ((1 - lastHour.good / lastHour.total) * 100) / budget : null;
  // A fast burn is the urgent one, even when the budget is already gone.
  const state = burnRate1h !== null && burnRate1h >= FAST_BURN ? 'burning' : consumed >= 1 ? 'exhausted' : 'ok';

  return {
    target,
    sli: (window.good / window.total) * 100,
    budget,
    consumed: Number.isFinite(consumed) ? consumed : 1,
    burnRate1h,
    state,
  };
}

/**
 * Requests and server errors from ingress rate samples: every 10 s sample is the rate over its interval, so the
 * count is the sum of all samples' rates × the sample interval (independent of how much of a bucket had traffic).
 */
export function countsFromRates(
  rateSums: { requests: number; errors: number },
  sampleSeconds: number,
): { good: number; total: number } {
  const total = rateSums.requests * sampleSeconds;
  const errors = rateSums.errors * sampleSeconds;

  return { good: Math.max(0, total - errors), total };
}

/** Latency objective: minutes with traffic whose percentile stayed at or under the threshold count as good. */
export function latencyCounts(
  minutes: readonly { latencyMs: number }[],
  thresholdMs: number,
): { good: number; total: number } {
  return { good: minutes.filter((m) => m.latencyMs <= thresholdMs).length, total: minutes.length };
}

/** The state of a service from its objectives: the most urgent wins (burning > exhausted > ok > no data). */
export function worstObjective(states: readonly ObjectiveStatus['state'][]): ObjectiveStatus['state'] {
  for (const s of ['burning', 'exhausted', 'ok'] as const) if (states.includes(s)) return s;

  return 'no-data';
}

/** `shop.example.com` → exact match; `*.example.com` → SQL LIKE pattern for the ingress entities. */
export function hostPattern(host: string): { like: boolean; value: string } {
  if (!host.includes('*')) return { like: false, value: host.toLowerCase() };

  return {
    like: true,
    value: host
      .toLowerCase()
      .replace(/[%_\\]/g, '\\$&')
      .replace(/\*/g, '%'),
  };
}
