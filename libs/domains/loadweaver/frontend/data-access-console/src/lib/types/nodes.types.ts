/** Nodes & sites (3.2, 3.21): `GET /nodes`, lifecycle actions, `GET /cluster` and join tokens. */

export type NodeLifecycle = 'pending' | 'importing' | 'active' | 'cordoned' | 'draining' | 'leaving' | 'left';

export interface NodeResources {
  cpuMillis: number;
  memoryBytes: number;
  diskBytes: number;
}

/** `GET /nodes/:name/platform` (2026-10-30): platform components a node runs, read-only. */
export type NodePlatformComponentKind =
  | 'etcd'
  | 'postgres'
  | 'queue'
  | 'control-plane-api'
  | 'log-store'
  | 'object-store'
  | 'registry'
  | 'registry-mirror'
  | 'ingress'
  | 'dns'
  | 'vpn-gateway'
  | 'bgp'
  | 'rate-limiter'
  | 'backup-server';
export type NodePlatformRole = 'leader' | 'replica' | 'member' | 'witness' | 'pending' | 'active' | 'standby';
export type NodePlatformState = 'running' | 'failed' | 'unknown';

/** `NodePlatformComponentDto`. */
export interface NodePlatformComponent {
  id: string;
  component: NodePlatformComponentKind;
  /** English label from the API (the console localizes by `component`). */
  label: string;
  role?: NodePlatformRole;
  state: NodePlatformState;
  detail?: string;
}

/** `NodeResponseDto`. */
export interface ConsoleNode {
  name: string;
  site: string;
  lifecycle: NodeLifecycle;
  labels: Record<string, string>;
  controlPlane: boolean;
  witness: boolean;
  agentVersion: string | null;
  os: { id: string; versionId: string; kernel: string; arch: string } | null;
  capabilities: Record<string, unknown> | null;
  capacity: NodeResources | null;
  usage: NodeResources | null;
  endpointHost: string | null;
  overlayV4: string | null;
  overlayV6: string | null;
  podSubnetV4: string | null;
  podSubnetV6: string | null;
  appliedRevision: number;
  applyStatus: 'applied' | 'failed' | 'rolled-back' | null;
  applyError: string | null;
  certificateNotAfter: string | null;
  lastSeenAt: string | null;
  connected: boolean;
  joinedAt: string;
}

/** Runtime actions on a node (not plan / apply). `confirm-lost` is for cluster admins only. */
export type NodeAction = 'cordon' | 'uncordon' | 'drain' | 'leave' | 'confirm-lost';

/** `GET /cluster`. */
/** `GET /cluster/siem` (3.18): delivery state per SIEM target. */
export interface SiemDeliveryStatus {
  name: string;
  forwarded: number;
  failures: number;
  lastError: string | null;
  nextAttemptAt: string | null;
}

export interface ClusterSummary {
  clusterId: string;
  displayName: string;
  caCertificate: string;
  desiredRevision: number;
  /** The cluster's public API URL (its installer embeds it) and console URL; null when not configured. */
  publicUrl?: string | null;
  consoleUrl?: string | null;
  nodes: { total: number; connected: number; sites: string[] };
  controlPlane: {
    members: string[];
    votingWitnesses: string[];
    automaticFailover: boolean;
    warnings: string[];
    /** Built-in control-plane member (3.39); absent on older clusters. */
    builtin?: BuiltinControlPlaneMember;
    /** How the active master key is held (names only); absent on older clusters. */
    masterKey?: {
      state: 'none' | 'sealed' | 'unsealed';
      threshold: number;
      holders: string[];
      kms: string | null;
      builtinStandby: boolean;
    };
  };
}

/**
 * The built-in control-plane member (3.39): a master-key holder inside the control-plane API, never a node and never
 * schedulable. `active` = sole holder (no node can hold a share), `standby` = keeps an in-sync copy for takeover.
 */
export interface BuiltinControlPlaneMember {
  mode: 'auto' | 'always' | 'off';
  state: 'ok' | 'off' | 'key-mismatch' | 'missing-key' | 'error';
  role: 'active' | 'standby' | 'participant' | 'off';
  holder: boolean;
  standby: boolean;
  realMembers: number;
  instance: string | null;
  lastSeenAt: string | null;
}

/** `GET /join-tokens`: active (unused, unexpired, unrevoked) tokens. */
export interface JoinToken {
  id: string;
  tokenPrefix: string;
  description: string | null;
  site: string;
  labels: Record<string, string>;
  witness: boolean;
  expiresAt: string;
  usedAt: string | null;
  usedByNode: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Returned once on creation; the plaintext token is never shown again. */
export interface CreatedJoinToken extends JoinToken {
  token: string;
}

/** `POST /join-tokens`. `ttlMinutes`: 1 to 1,440 (default 60). */
export interface CreateJoinTokenRequest {
  site?: string;
  labels?: Record<string, string>;
  witness?: boolean;
  ttlMinutes?: number;
  description?: string;
}
