/** Explained health tree states (3.25). Ordered from best to worst for comparisons. */
export const HEALTH_STATES = ['healthy', 'degraded', 'at-risk', 'failed', 'unknown'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** Machine-readable reason, so every badge can answer "why" (3.25). */
export interface HealthReason {
  code: string;
  message: string;
  /** Entities involved, e.g. `volume/shop/db-data`. */
  affected?: string[];
}

export interface HealthStatus {
  state: HealthState;
  reasons: HealthReason[];
}

const SEVERITY: Record<HealthState, number> = { healthy: 0, unknown: 1, degraded: 2, 'at-risk': 3, failed: 4 };

export function healthSeverity(state: HealthState): number {
  return SEVERITY[state];
}

export function worseHealth(a: HealthState, b: HealthState): HealthState {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export const HEALTHY: HealthStatus = Object.freeze({ state: 'healthy', reasons: [] }) as HealthStatus;
