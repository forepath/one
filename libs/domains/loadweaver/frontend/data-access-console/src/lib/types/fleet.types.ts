/**
 * The fleet service's API (3.24, `libs/domains/loadweaver/backend/feature-fleet/spec/openapi.yaml`): cluster
 * connections and grants, the fleet views (cards, merged inbox, sites, comparison), cross-cluster operations, the
 * Loadweaver Cloud teardown status and the fleet's audit log.
 */

export type FleetRole = 'viewer' | 'operator' | 'admin';

export const FLEET_ROLES: readonly FleetRole[] = ['viewer', 'operator', 'admin'];

export type FleetHealthState = 'unknown' | 'healthy' | 'degraded' | 'unreachable' | 'credential-rejected';

export type FleetClusterState = 'active' | 'teardown' | 'retired';

/** A connection probe: the fleet's view of a cluster's API. */
export interface FleetClusterHealth {
  state: FleetHealthState;
  checkedAt: string | null;
  latencyMs: number | null;
  /** `X-Loadweaver-Version` of the control plane. */
  version: string | null;
  clusterId: string | null;
  error: string | null;
}

/** The caller's access to a cluster through the fleet (fleet admins: admin everywhere). */
export interface FleetClusterAccess {
  clusterRole: FleetRole | null;
  projects: Record<string, FleetRole>;
  /** Read-only grace of a Loadweaver Cloud teardown: every role is capped at viewer. */
  readOnly: boolean;
}

/** A cluster connection; the service credential is never returned (only its last four characters). */
export interface FleetCluster {
  id: string;
  name: string;
  description: string | null;
  endpoint: string;
  hasCustomCa: boolean;
  credentialHint: string;
  /** `decabill:<subscription>:<item>` for Loadweaver Cloud clusters. */
  reference: string | null;
  state: FleetClusterState;
  readOnlyUntil: string | null;
  readOnlyReason: string | null;
  health: FleetClusterHealth;
  access: FleetClusterAccess;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFleetCluster {
  name: string;
  description?: string;
  endpoint: string;
  /** PAT of the cluster's fleet service user: write-only. */
  credential: string;
  caCertificate?: string;
  test?: boolean;
}

/** Only what changes; `credential` rotates the service credential, `caCertificate: ''` removes a custom CA. */
export interface UpdateFleetCluster {
  description?: string;
  endpoint?: string;
  credential?: string;
  caCertificate?: string;
}

export interface TestFleetConnection {
  endpoint: string;
  credential: string;
  caCertificate?: string;
}

export interface FleetGrant {
  id: string;
  clusterId: string;
  userId: string;
  role: FleetRole;
  /** `null`: cluster-wide. */
  project: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface PutFleetGrant {
  userId: string;
  role: FleetRole;
  project?: string;
}

/** A fleet user for grants (the fleet's identity, `GET /users`, global admins). */
export interface FleetUser {
  id: string;
  email: string;
}

export interface FleetCardCapacity {
  cpu: { used: number; total: number; percent: number | null };
  memory: { used: number; total: number; reserve: number; percent: number | null };
}

/** One card per cluster on the fleet overview (3.25). */
export interface FleetCard {
  id: string;
  name: string;
  reference: string | null;
  state: FleetClusterState | string;
  readOnlyUntil: string | null;
  connection: FleetClusterHealth;
  /** The cluster's own health headline. */
  health: { state: string; message: string } | null;
  sites: number | null;
  nodes: { total: number; up: number } | null;
  deployments: number | null;
  capacity: FleetCardCapacity | null;
  version: string | null;
  latestAvailable: string | null;
  upgradeAvailable: boolean;
  activeRollout: string | null;
  openAlerts: number | null;
  pendingPlans: number | null;
  inbox: { critical: number; warning: number; info: number };
  /** Console route: `/clusters/<id>/overview`. */
  link: string;
  /** Project-only grants: aggregates are left out. */
  limited: boolean;
  errors: string[];
  fetchedAt: string | null;
}

/** An item of the merged needs-attention inbox; `link` is prefixed with `/clusters/<id>`. */
export interface FleetInboxItem {
  clusterId: string;
  clusterName: string;
  kind: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  link: string;
  project: string | null;
  since: string | null;
  /**
   * The item in the cluster's **own** console (`<endpoint><link>`): approvals and anything else the relay doesn't
   * carry are resolved there.
   */
  nativeUrl?: string | null;
}

export interface FleetSite {
  clusterId: string;
  clusterName: string;
  site: string;
  latitude: number;
  longitude: number;
  label: string | null;
}

export interface FleetSites {
  sites: FleetSite[];
  /** Sites without `spec.location`. */
  withoutLocation: number;
}

export interface FleetDriftItem {
  kind: string;
  project: string | null;
  name: string;
  /** Spec hash per cluster id (`null`: missing there). */
  clusters: Record<string, string | null>;
  state: 'missing' | 'different';
}

export interface FleetComparison {
  clusters: { id: string; name: string }[];
  versions: { clusterId: string; version: string | null; latestAvailable: string | null }[];
  sameVersion: boolean;
  capacity: {
    clusterId: string;
    capacity: FleetCardCapacity | null;
    nodes: { total: number; up: number } | null;
    sites: number | null;
  }[];
  policyDrift: {
    kinds: string[];
    identical: number;
    missing: number;
    different: number;
    items: FleetDriftItem[];
  };
}

export type FleetOperationKind = 'cross-cluster-restore' | 'clone' | 'final-backup';
export type FleetOperationStatus = 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type FleetStepStatus = 'pending' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'skipped';

export interface FleetOperationStep {
  key: string;
  status: FleetStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  detail: Record<string, unknown>;
  error: string | null;
  attempts: number;
}

export interface FleetOperation {
  id: string;
  kind: FleetOperationKind;
  status: FleetOperationStatus;
  sourceClusterId: string | null;
  targetClusterId: string;
  params: Record<string, unknown>;
  steps: FleetOperationStep[];
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `POST /operations`: cross-cluster restore or clone (3.20). */
export interface CreateFleetOperation {
  kind: 'cross-cluster-restore' | 'clone';
  sourceClusterId: string;
  targetClusterId: string;
  /** Source backups and the target volume each one is restored into (1–16). */
  backups: { backupId: string; volume: string }[];
  target: { project: string; deployment: string };
  /** Clone only: the source deployment copied to the target first. */
  clone?: { project: string; deployment: string };
  mode?: 'replace' | 'merge';
  /** Apply the plans on the target (its approvals still hold); default: the plans wait there. */
  apply?: boolean;
}

/** Loadweaver Cloud: the cluster's teardown state and its latest final backup. */
export interface FleetCloudStatus {
  cluster: FleetCluster;
  finalBackup: FleetOperation | null;
}

export interface FleetAuditEntry {
  seq: string;
  at: string;
  actorType: 'user' | 'api-key' | 'system';
  actorId: string | null;
  action: string;
  clusterId: string | null;
  target: string;
  details: Record<string, unknown>;
}

export interface FleetAuditFilter {
  cluster?: string;
  action?: string;
}

/** A source backup for the restore wizard, read through the relay (`GET /backups?project=`). */
export interface FleetSourceBackup {
  id: string;
  project: string | null;
  resource: string;
  status: string;
  bytes: number;
  startedAt: string;
  finishedAt: string | null;
}
