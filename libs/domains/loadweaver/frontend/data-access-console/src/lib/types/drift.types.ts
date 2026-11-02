/** Drift (3.8): `GET /drift`, `POST /drift/plans`. */
import type { GitAheadEntry } from './git.types';

/** A container on a node that Loadweaver doesn't manage (e.g. `docker run`). */
export interface DriftContainer {
  node: string;
  id: string;
  name: string;
  image: string;
  state: string;
  ports: string[];
  reportedAt: string;
}

/** A failed rollback: configuration and reality may differ until its fix-forward plan is applied. */
export interface DriftInconsistency {
  planId: string;
  error: string | null;
  fixForward: string | null;
}

/** A container a workload with the node's Docker socket started itself (e.g. Agenstra environments). */
export interface DelegatedContainer extends DriftContainer {
  /** The replica that started it. */
  delegatedTo: string;
}

export interface DriftReport {
  containers: DriftContainer[];
  /** Not drift: owned by the workload that started them. */
  delegated?: DelegatedContainer[];
  inconsistent: DriftInconsistency[];
  /** Git scopes whose default branch is ahead of the cluster: its plan isn't applied, or the push was rejected. */
  gitAhead?: GitAheadEntry[];
}

/** Turns a foreign container into a proposed `Deployment` plan. */
export interface ProposeDriftPlan {
  node: string;
  container: string;
  project: string;
  deployment: string;
}
