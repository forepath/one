import type { HealthState } from './console.types';

/** The explained health tree (3.25): `GET /health/tree`, `GET /health/history`. */

export type HealthKind = 'cluster' | 'site' | 'node' | 'project' | 'deployment' | 'service' | 'replica' | 'volume';

/** Why an entity is in its state: a machine-readable code, a sentence, and the entities behind it. */
export interface HealthReason {
  code: string;
  message: string;
  entities?: string[];
}

export interface HealthEntity {
  /** `cluster`, `site/fra1`, `node/n1`, `project/shop`, `deployment/shop/store`, … */
  key: string;
  kind: HealthKind;
  name: string;
  parent: string | null;
  project: string | null;
  state: HealthState;
  reasons: HealthReason[];
  /** When the entity entered its state. */
  since: string;
}

export interface HealthChange {
  at: string;
  from: HealthState | null;
  to: HealthState;
  message: string;
}

export interface HealthHistory {
  key: string;
  changes: HealthChange[];
  /** Time spent in each state in the range, in milliseconds. */
  durations: Partial<Record<HealthState, number>>;
}

export interface HealthTreeQuery {
  project?: string;
  root?: string;
}

export interface HealthHistoryQuery {
  key: string;
  from?: string;
  to?: string;
}

/** A health entity with its children (built from the flat list). */
export interface HealthTreeNode {
  entity: HealthEntity;
  children: HealthTreeNode[];
}
