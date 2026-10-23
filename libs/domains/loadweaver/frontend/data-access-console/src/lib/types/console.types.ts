/** Shapes of the control-plane API the console reads (see the OpenAPI spec of the control plane). */

export type HealthState = 'healthy' | 'degraded' | 'at-risk' | 'failed' | 'unknown';
export type ClusterRole = 'cluster-admin' | 'infra-operator' | 'auditor';
export type ProjectRole = 'viewer' | 'developer' | 'operator' | 'admin';

/** `GET /access/me`: who the caller is in this cluster. */
export interface AccessMe {
  userId: string | null;
  clusterRole: ClusterRole | null;
  projects: Record<string, ProjectRole>;
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
    | 'git-error';
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
