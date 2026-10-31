import type { IsolationState, Labels, Runtime, Selector } from '@forepath/loadweaver/shared/util-model';

export interface Resources {
  cpuMillis: number;
  memoryBytes: number;
}

/** Probe result of one isolation level on a node (agent capability `isolation`, 3.1), for unschedulable reasons. */
export interface NodeIsolationStatus {
  state: IsolationState;
  /** Agenstra's reason codes, e.g. `E_KVM_UNAVAILABLE`. */
  reasonCode?: string;
  reason?: string;
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
  /**
   * Isolation levels whose probe passed on the node (3.1). A service runs only on nodes with **exactly** its level:
   * never upgraded or downgraded (the strength order is for selectors, capability views and plan output only).
   */
  runtimes: Runtime[];
  /** Per-level probe states with reasons; only used to explain unschedulable services. */
  isolation?: Partial<Record<Runtime, NodeIsolationStatus>>;
  /**
   * KVM on the node (3.1): `usable` = `/dev/kvm` present and openable with the module loaded; `optOut` = node spec
   * `virtualization.kvm: disabled`. `undefined` (agent doesn't report it) counts as no usable KVM: KVM levels,
   * `/dev/kvm` pass-through and full VMs need it.
   */
  kvm?: { usable: boolean; optOut: boolean };
  /** Full VMs possible (3.35: microvm ready, DRBD 9, UEFI firmware in the launcher); `undefined` counts as no. */
  virtualMachines?: boolean;
  /**
   * DRBD volumes in block mode (VM disks, 3.35); `undefined` counts as available when the node holds volumes at all
   * and its agent has `vm-block-volumes`.
   */
  blockVolumes?: boolean;
  /**
   * CPU architecture of the node (`amd64` / `arm64`, from the agent's hello). Services with `architectures` run only
   * on nodes of those architectures; `undefined` (not reported) passes.
   */
  arch?: string;
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
  /** `block`: a raw DRBD device (VM disk, 3.35); its copies need nodes with block-volume support. Default filesystem. */
  mode?: 'filesystem' | 'block';
}

export interface SchedulerService {
  /** `project/deployment/service` */
  id: string;
  project: string;
  replicas: number;
  requests: Resources;
  /** Exact isolation level the replicas run at (3.1). */
  runtime: Runtime;
  /** `/dev/kvm` passed into the container (3.1): only nodes with usable KVM that aren't opted out. */
  needsKvmDevice?: boolean;
  /** A full VM (3.35, kind `VirtualMachine`, runtime `microvm`): only nodes with `virtualMachines`. */
  virtualMachine?: boolean;
  selector?: Selector;
  /**
   * Node architectures the pinned image can run on (3.35: a microVM guest image's `platformLayers`, a VM image's
   * architecture). Hard rule: nodes of other architectures get no replicas (already placed ones move). Absent: any.
   */
  architectures?: string[];
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
