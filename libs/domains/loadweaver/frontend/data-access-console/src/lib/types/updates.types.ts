import type { ConsoleResource } from './resources.types';

/** Updates (3.26): `GET /updates/status`, `GET /updates/releases`, `GET /updates/rollouts[/{id}]`. */

export type ReleaseChannel = 'stable' | 'beta';

/** `announced` (GitHub), `importing` (bundle download / upload running), `available` (imported), `installed`. */
export type ReleaseStatus = 'announced' | 'importing' | 'available' | 'failed' | 'installed';

/** A release known to the cluster with its bundle's manifest (signature, notes, pinned components). */
export interface UpdateRelease {
  version: string;
  channel: ReleaseChannel;
  status: ReleaseStatus;
  /** `github`, `mirror`, `upload` or `installed` (the running control plane's own release). */
  source: string;
  signed: boolean;
  keyId: string | null;
  notes: string[];
  components: { name: string; kind: string; version: string }[];
  clusterImages: string[];
  announcement: { name?: string; htmlUrl?: string; publishedAt?: string; changelog?: string[] } | null;
  error: string | null;
  importedAt: string | null;
  importedBy: string | null;
}

export type UpdatePolicyMode = 'notify' | 'auto-patch' | 'manual';

/** `Cluster.spec.updates` (defaults applied). */
export interface ClusterUpdatePolicy {
  policy: UpdatePolicyMode;
  channel: ReleaseChannel;
  source: 'github' | 'mirror' | 'upload';
  mirrorUrl?: string;
  osUpdates: boolean;
  settleSeconds: number;
  stepTimeoutMinutes: number;
}

/** A node's maintenance-window state: whether a window is open now and when the next one opens / closes. */
export interface NodeWindowState {
  open: boolean;
  opensAt: string | null;
  closesAt: string | null;
  /** The windows that select the node. */
  windows: string[];
}

export interface UpdatesNodeStatus {
  name: string;
  site: string;
  controlPlane: boolean;
  connected: boolean;
  agentVersion: string | null;
  /** The release the node runs and the one it is moving to. */
  release: string | null;
  target: string | null;
  os: string | null;
  kernel: string | null;
  rebootRequired: boolean;
  /** Components pinned on the node outside the release. */
  overrides: string[];
  /** The agent manages components (protocol feature `components`). */
  components: boolean;
  window: NodeWindowState;
}

export interface UpdatesStatus {
  clusterVersion: string | null;
  controlPlaneVersion: string | null;
  policy: ClusterUpdatePolicy;
  /** The rollout in progress (approved, running, paused, rolling back), if any. */
  activeRollout: string | null;
  latestAvailable: string | null;
  nodes: UpdatesNodeStatus[];
  contractMigrations: { ready: boolean; blockers: string[] };
}

export type RolloutStatus =
  | 'planned'
  | 'approved'
  | 'running'
  | 'paused'
  | 'rolling-back'
  | 'rolled-back'
  | 'rollback-failed'
  | 'completed'
  | 'cancelled'
  | 'superseded';

/** Statuses of a rollout in progress (polled by the console). */
export const ACTIVE_ROLLOUT_STATUSES: readonly RolloutStatus[] = ['approved', 'running', 'paused', 'rolling-back'];

export type RolloutKind = 'patch' | 'minor' | 'major' | 'os' | 'downgrade';

export interface RolloutOptions {
  windows: 'respect' | 'ignore';
  host: boolean;
  osUpgrade: boolean;
  snapshot?: string;
  automatic: boolean;
  emergency: boolean;
}

/** One line of the plan's diff: a node's component from → to, and how it updates. */
export interface RolloutDiffEntry {
  node: string;
  component: string;
  from: string | null;
  to: string | null;
  method: string;
}

/** Per wave: what is unavailable or at risk while it runs. */
export interface RolloutWaveRisk {
  wave: number;
  nodes: string[];
  risk: string[];
}

export type RolloutStepState =
  | 'pending'
  | 'waiting-window'
  | 'draining'
  | 'switchover'
  | 'applying'
  | 'rebooting'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'rolling-back'
  | 'rolled-back'
  | 'rollback-failed'
  | 'skipped';

export interface RolloutGateResult {
  name: string;
  ok: boolean;
  message: string;
}

export interface RolloutStep {
  index: number;
  /** 0 = control-plane members, 1 = canary, 2… = waves. */
  wave: number;
  phase: 'control-plane' | 'canary' | 'wave' | string;
  node: string;
  site: string;
  /** `components` (images + agent, no drain) or `host` (drain → packages / kernel → reboot → rejoin). */
  kind: 'components' | 'host' | string;
  state: RolloutStepState;
  from: string | null;
  to: string | null;
  error: string | null;
  gates: RolloutGateResult[];
  startedAt: string | null;
  finishedAt: string | null;
}

/** An update plan and its rollout. */
export interface Rollout {
  id: string;
  status: RolloutStatus;
  kind: RolloutKind | string;
  fromVersion: string | null;
  toVersion: string;
  options: RolloutOptions;
  diff: RolloutDiffEntry[];
  notes: string[];
  warnings: string[];
  failureAnalysis: RolloutWaveRisk[];
  createdBy: string | null;
  /** Resolved server-side (`null`: deleted user / not a user); the console shows it instead of the id (D11). */
  createdByEmail?: string | null;
  approvedBy: string | null;
  approvedByEmail?: string | null;
  approvedAt: string | null;
  pauseReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  progress: { done: number; total: number; currentWave: number | null };
  steps: RolloutStep[];
}

/** `POST /updates/rollouts`: the target release (default: the newest available) and host updates. */
export interface CreateRolloutRequest {
  version?: string;
  host?: boolean;
  osUpgrade?: boolean;
}

/** Actions on an update plan (cluster admins); `approve` may carry `emergency` (run outside maintenance windows). */
export type RolloutAction = 'approve' | 'pause' | 'resume' | 'rollback' | 'cancel';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** `MaintenanceWindow` (cluster scope): weekly recurrence in a time zone; `end` before `start` crosses midnight. */
export interface MaintenanceWindowSpec {
  description?: string;
  selector?: {
    names?: string[];
    matchLabels?: Record<string, string>;
    matchExpressions?: { key: string; operator: string; values?: string[] }[];
  };
  sites?: string[];
  days: Weekday[];
  start: string;
  end: string;
  timeZone: string;
}

export type MaintenanceWindowResource = ConsoleResource<MaintenanceWindowSpec>;

/** A bundle upload in flight. */
export interface BundleUploadProgress {
  fileName: string;
  loaded: number;
  total: number;
}
