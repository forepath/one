/** Shapes of the control-plane API the console reads (see the OpenAPI spec of the control plane). */

export type HealthState = 'healthy' | 'degraded' | 'at-risk' | 'failed' | 'unknown';
export type ClusterRole = 'cluster-admin' | 'infra-operator' | 'auditor';
export type ProjectRole = 'viewer' | 'developer' | 'operator' | 'admin';

/** `GET /access/me`: who the caller is in this cluster. */
export interface AccessMe {
  userId: string | null;
  clusterRole: ClusterRole | null;
  projects: Record<string, ProjectRole>;
  /**
   * Cluster admins only: forced email login 2FA is not enforced because SMTP isn't configured (warning banner).
   * Missing from older control planes.
   */
  emailLogin2faSuspended?: boolean;
  /**
   * Fleet mode (3.24): the active cluster verifies this fleet's identity claims, so approvals work through the fleet
   * (`userId` is then the acting person `fleet:<issuer>:<userId>`). Absent in single-cluster mode.
   */
  fleetApprovals?: boolean;
  /**
   * Fleet mode (2026-10-27): the active cluster verifies this fleet's per-user claims (also during the read-only
   * grace), so personal data like search favourites is the person's there. Absent in single-cluster mode.
   */
  fleetIdentity?: boolean;
  /** Fleet mode: the project role a cluster-wide fleet grant gives in every project (operator / viewer). */
  allProjects?: ProjectRole;
}

export interface InboxItem {
  kind:
    | 'rollback-failed'
    | 'health'
    | 'approval'
    | 'pins'
    | 'drift'
    | 'alert'
    | 'certificate'
    | 'cross-project-request'
    | 'git-ahead'
    | 'git-push-rejected'
    | 'git-error'
    | 'backups'
    | 'master-key'
    | 'database';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  /** Console route where it is resolved. */
  link: string;
  project?: string;
  since?: string;
}

export interface OverviewSummary {
  sites: number;
  nodes: { total: number; up: number };
  deployments: number;
  capacity: {
    cpuMillis: { used: number; total: number };
    memoryBytes: { used: number; total: number; reserve: number };
  } | null;
  requestsPerSecond: number | null;
  deniedPackets5m: number | null;
  alertsFiring: number;
  slos: { total: number; ok: number; burning: number; exhausted: number };
  /** Only while the control plane is read-only (3.43): the SLOs reach until `metricsAsOf`, the rest is live. */
  readOnly?: { metricsAsOf: string | null };
}

export interface ActivityItem {
  time: string;
  kind: string;
  entity: string;
  project: string | null;
  message: string;
}

/** `GET /overview`. */
export interface Overview {
  headline: { state: HealthState; message: string; key: string | null };
  inbox: InboxItem[];
  summary: OverviewSummary;
  activity: ActivityItem[];
}
