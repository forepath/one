import type { Labels, Selector } from '@forepath/loadweaver/shared/util-model';

export interface Resources {
  cpuMillis: number;
  memoryBytes: number;
}

export interface SchedulerNode {
  name: string;
  site: string;
  labels: Labels;
  /** Only `active` nodes receive new replicas; cordoned / draining nodes keep nothing new (3.12). */
  lifecycle: 'active' | 'cordoned' | 'draining' | 'leaving';
  witness: boolean;
  /** Allocatable capacity (node capacity minus the platform reserve). */
  capacity: Resources;
  diskBytes: number;
  runtimes: ('runc' | 'sandboxed')[];
  /** Unreachable nodes are treated as lost (failover, 3.10). */
  reachable: boolean;
  /**
   * DRBD 9 kernel module available (3.5): `false` keeps volume primaries and replicas off the node; `undefined`
   * (agent doesn't report it) counts as available.
   */
  drbd9?: boolean;
  /**
   * Why the node isn't ready for new volume copies yet (joining, still applying its first desired states): it keeps
   * the copies it holds but gets no new ones, and new volumes get their primary elsewhere when possible (M6 gate).
   */
  notReady?: string;
  /**
   * Protocol features the node's agent negotiated (`lw_nodes.protocol_features`). Services with `requiredFeatures`
   * get new replicas only on nodes that have them; `undefined` (not known) counts as having every feature.
   */
  features?: string[];
}

export interface SchedulerVolume {
  id: string;
  sizeBytes: number;
  /** Replicas within the primary's site, including the primary. */
  replicas: number;
  crossSite: 'async' | 'sync' | 'none';
}

export interface SchedulerService {
  /** `project/deployment/service` */
  id: string;
  project: string;
  replicas: number;
  requests: Resources;
  runtime: 'runc' | 'sandboxed';
  selector?: Selector;
  spread: 'node' | 'site';
  /** Replicated volumes mounted read-write; force a single replica co-located with the volume primary. */
  volumes: SchedulerVolume[];
  /**
   * Agent protocol features new replicas need on their node (e.g. `egress-policies` for per-source egress settings
   * older agents can't apply, M6 gate). Replicas already placed on a node without them stay (the plan warns).
   */
  requiredFeatures?: string[];
  /** Why the features are needed, for the unschedulable reason (e.g. `denyUrlPatterns`). */
  requiredFeaturesReason?: string;
}

export interface ReplicaPlacement {
  service: string;
  /** `project/deployment/service/<index>` */
  replica: string;
  node: string;
}

export interface VolumePlacement {
  volume: string;
  primary: string;
  /** Synchronous replicas (same site), excluding the primary. */
  syncReplicas: string[];
  /** Replicas in other sites; asynchronous unless the volume asks for sync cross-site replication (3.5). */
  remoteReplicas: string[];
}

export interface ScheduleInput {
  nodes: SchedulerNode[];
  services: SchedulerService[];
  /** Current placements, kept where still valid (stability; migrations only when needed). */
  current?: { replicas: ReplicaPlacement[]; volumes: VolumePlacement[] };
}

export interface Unschedulable {
  service: string;
  replica?: string;
  reason: string;
}

export interface ScheduleResult {
  replicas: ReplicaPlacement[];
  volumes: VolumePlacement[];
  unschedulable: Unschedulable[];
  /** Requested resources per node after placement. */
  allocated: Record<string, Resources>;
  /**
   * Volume copies held back from nodes that aren't ready (`SchedulerNode.notReady`): the volume got fewer copies (or
   * its primary on such a node, as the only fit) — planning again once the nodes are ready adds them.
   */
  held?: HeldVolumeCopy[];
}

export interface HeldVolumeCopy {
  volume: string;
  /** Not-ready nodes that would otherwise have been considered, with their reasons. */
  nodes: { name: string; reason: string }[];
  /** `replica`: fewer copies than asked for; `primary`: the primary had to go to a not-ready node. */
  kind: 'replica' | 'primary';
}

export type FailureScope = { kind: 'node'; name: string } | { kind: 'site'; name: string };

export interface SinglePointOfFailure {
  scope: FailureScope;
  kind: 'data' | 'deployment' | 'capacity';
  subject: string;
  reason: string;
}

export interface FailureAnalysis {
  /** Every single point of failure with its cause (3.12). */
  findings: SinglePointOfFailure[];
  /** N+1: every single node loss can be absorbed by the remaining nodes. */
  nPlusOne: boolean;
}
