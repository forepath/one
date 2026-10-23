/** Service level objectives (3.25): `GET /slos`. */

/** `no-data`: no traffic in the window. */
export type SloState = 'ok' | 'burning' | 'exhausted' | 'no-data';
export type SloWindow = '7d' | '28d' | '30d';

/** One objective over its rolling window: SLI, error budget and how fast it burns. */
export interface SloObjective {
  /** Target in percent (e.g. 99.9). */
  target: number;
  /** Measured share of good events in percent; null without traffic. */
  sli: number | null;
  /** The error budget in percent of events (100 − target). */
  budget: number;
  /** Share of the budget used (0 = untouched, 1 = exhausted). */
  consumed: number;
  /** Error rate of the last hour relative to the budget (1 = sustainable). */
  burnRate1h: number | null;
  state: SloState;
}

export interface SloLatencyObjective extends SloObjective {
  percentile: 'p95' | 'p99';
  thresholdMs: number;
}

/** The SLO of one exposed service. */
export interface Slo {
  project: string;
  deployment: string;
  service: string;
  hosts: string[];
  window: SloWindow;
  availability?: SloObjective;
  latency?: SloLatencyObjective;
  /** Availability since the start of the calendar month (UTC), in percent. */
  monthlyUptime: number | null;
  /** The worst objective's state. */
  state: SloState;
}

/** The burn rate from which an objective counts as burning (2 % of a 30-day budget in one hour). */
export const SLO_FAST_BURN = 14.4;
