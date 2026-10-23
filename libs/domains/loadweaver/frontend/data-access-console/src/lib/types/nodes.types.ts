/** Nodes & sites (3.2, 3.21): `GET /nodes`, lifecycle actions, `GET /cluster` and join tokens. */

export type NodeLifecycle = 'pending' | 'importing' | 'active' | 'cordoned' | 'draining' | 'leaving' | 'left';

export interface NodeResources {
  cpuMillis: number;
  memoryBytes: number;
  diskBytes: number;
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
export interface ClusterSummary {
  clusterId: string;
  displayName: string;
  caCertificate: string;
  desiredRevision: number;
  nodes: { total: number; connected: number; sites: string[] };
  controlPlane: { members: string[]; votingWitnesses: string[]; automaticFailover: boolean; warnings: string[] };
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
