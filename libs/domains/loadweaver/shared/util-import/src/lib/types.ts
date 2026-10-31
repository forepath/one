import type { DiscoveryReport } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { NodeImportStep, Resource } from '@forepath/loadweaver/shared/util-model';

/** What happens to a discovered item (3.21): imported as a deployment here, migrated to other nodes, left alone. */
export type ImportChoice = 'import' | 'migrate' | 'ignore';

/** What happens to the data of a volume or bind mount of an imported item. */
export type VolumeHandling = 'copy' | 'empty' | 'keep';

/** A discovered unit the wizard decides on: a compose project or a standalone container. */
export interface DiscoveredItem {
  /** `compose:<project>` or `container:<name>`. */
  id: string;
  kind: 'compose' | 'container';
  name: string;
  /** Container ids, in discovery order. */
  containers: string[];
  services: string[];
  /** Published host ports of its containers. */
  ports: { protocol: 'tcp' | 'udp' | 'sctp'; hostPort: number; containerPort: number; service: string }[];
  /** Volumes and bind mounts (key = `volume:<name>` / `bind:<source>`). */
  mounts: {
    key: string;
    type: 'volume' | 'bind';
    source: string;
    destination: string;
    service: string;
    sizeBytes: number | null;
    directory?: boolean;
  }[];
  /** Has read-write volumes or bind mounts (stateful: migrate is refused). */
  stateful: boolean;
  /** Former Loadweaver workload (`loadweaver.com/managed`). */
  managed: boolean;
}

export interface ImportItemSelection {
  item: string;
  choice: ImportChoice;
  /** Target Loadweaver project (import / migrate). */
  project?: string;
  /** Deployment name; defaults to the compose project / container name. */
  deployment?: string;
  /** Hostname per published host port served over HTTP by the ingress (key: host port). */
  http?: Record<string, string>;
  /** Per mount key (`volume:<name>` / `bind:<source>`); default `copy`. */
  volumes?: Record<string, VolumeHandling>;
  /** Values for variables the discovery could not report (sensitive) or that are missing. */
  variables?: Record<string, string>;
}

export interface ImportSelections {
  items: ImportItemSelection[];
  /** Confirms discarding the identity and keys of a former, different cluster. */
  wipeFormerIdentity?: boolean;
}

/** What the plan builder needs to know about the cluster. */
export interface ImportClusterContext {
  clusterId: string;
  node: string;
  network: {
    podPoolV4?: string;
    podPoolV6?: string;
    servicePoolV4?: string;
    servicePoolV6?: string;
    overlayPoolV4?: string;
    overlayPoolV6?: string;
  };
  /** Subnets already allocated to the joining node (pod subnets, overlay addresses). */
  nodeSubnets?: string[];
  projects: string[];
  /** Existing deployments (`project/name`). */
  deployments: string[];
  /** Ingress forwards in use: `tcp/8080` → owning service. */
  forwardedPorts: Record<string, string>;
  /** HTTP hostnames in use → owning service. */
  hostnames: Record<string, string>;
  /** Replicated volumes and where their copies live (former-node classification). */
  volumes: { id: string; drbdMinor: number; holders: string[]; sizeBytes: number }[];
  /** Default volume size when discovery has no size (bytes). */
  defaultVolumeSizeBytes?: number;
}

export type ConflictKind = 'port' | 'interface' | 'subnet' | 'hostname' | 'name' | 'tunnel';

export interface ImportConflict {
  kind: ConflictKind;
  /** `error`: the plan is refused until it is resolved; `resolved`: the plan resolves it; `warning`: noted. */
  severity: 'error' | 'resolved' | 'warning';
  subject: string;
  reason: string;
  resolution?: string;
}

export interface ConflictResolution {
  conflicts: ImportConflict[];
  /** Host ports the node keeps for itself: generated WireGuard listen ports avoid them. */
  reservedPorts: { tcp: number[]; udp: number[] };
}

export interface FormerReplica {
  resource: string;
  minor: number;
  volume?: string;
  reason: string;
}

export interface FormerClassification {
  kind: 'same-cluster' | 'other-cluster' | 'unknown-cluster';
  clusterId?: string;
  nodeName?: string;
  /** Replicas this cluster still assigns to the node: kept, DRBD resyncs only the difference. */
  reusable: FormerReplica[];
  /** Replicas nothing assigns any more: removed when the node is activated. */
  discarded: FormerReplica[];
  /** The old identity and keys have to be discarded (different / unknown cluster). */
  requiresWipe: boolean;
}

export interface ImportedDeployment {
  item: string;
  choice: Exclude<ImportChoice, 'ignore'>;
  project: string;
  name: string;
  resource: Resource<'Deployment'>;
  /** Source containers, in stop order (dependents first). */
  containers: string[];
  copies: { source: string; volume: string }[];
  /** Host ports the source held: freed by the stop, taken over by the ingress. */
  ports: { protocol: 'tcp' | 'udp'; port: number }[];
}

export interface JoinPlan {
  node: string;
  former: FormerClassification | null;
  conflicts: ImportConflict[];
  /** The plan can't be created while there are errors. */
  errors: string[];
  warnings: string[];
  deployments: ImportedDeployment[];
  steps: NodeImportStep[];
  reservedPorts: { tcp: number[]; udp: number[] };
  /** Items left unmanaged: they stay visible as drift. */
  leftovers: string[];
  wipeFormerIdentity: boolean;
}

export type { DiscoveryReport };
