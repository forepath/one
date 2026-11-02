/** Import of existing Docker hosts and former nodes (3.21): mirrors the control plane's `/imports` API. */

export type ImportChoice = 'import' | 'migrate' | 'ignore';
export type VolumeHandling = 'copy' | 'empty' | 'keep';
export type ImportStatus = 'draft' | 'planned' | 'running' | 'done' | 'failed' | 'rolled-back' | 'discarded';

export interface ImportSummary {
  node: string;
  lifecycle: string;
  connected: boolean;
  hostname: string;
  discoveryId: string;
  discoveredAt: string;
  composeProjects: number;
  containers: number;
  volumes: number;
  former: 'none' | 'same-cluster' | 'other-cluster' | 'unknown-cluster';
  selection: { id: string; status: ImportStatus; planId: string | null } | null;
}

export interface DiscoveredItem {
  id: string;
  kind: 'compose' | 'container';
  name: string;
  containers: string[];
  services: string[];
  ports: { protocol: 'tcp' | 'udp' | 'sctp'; hostPort: number; containerPort: number; service: string }[];
  mounts: {
    key: string;
    type: 'volume' | 'bind';
    source: string;
    destination: string;
    service: string;
    sizeBytes: number | null;
    directory?: boolean;
  }[];
  stateful: boolean;
  managed: boolean;
}

export interface ImportItemSelection {
  item: string;
  choice: ImportChoice;
  project?: string;
  deployment?: string;
  http?: Record<string, string>;
  volumes?: Record<string, VolumeHandling>;
  variables?: Record<string, string>;
}

export interface ImportSelections {
  items: ImportItemSelection[];
  wipeFormerIdentity?: boolean;
}

export interface ImportConflict {
  kind: 'port' | 'interface' | 'subnet' | 'hostname' | 'name' | 'tunnel';
  severity: 'error' | 'resolved' | 'warning';
  subject: string;
  reason: string;
  resolution?: string;
}

export interface JoinPlanStep {
  id: string;
  kind: string;
  description: string;
  deployment?: string;
  containers?: string[];
  copies?: { source: string; volume: string }[];
  ports?: { protocol: 'tcp' | 'udp'; port: number }[];
  volumes?: string[];
}

export interface FormerClassification {
  kind: 'same-cluster' | 'other-cluster' | 'unknown-cluster';
  clusterId?: string;
  nodeName?: string;
  reusable: { resource: string; minor: number; volume?: string; reason: string }[];
  discarded: { resource: string; minor: number; volume?: string; reason: string }[];
  requiresWipe: boolean;
}

export interface JoinPlan {
  node: string;
  former: FormerClassification | null;
  conflicts: ImportConflict[];
  errors: string[];
  warnings: string[];
  deployments: { item: string; choice: ImportChoice; project: string; name: string }[];
  steps: JoinPlanStep[];
  reservedPorts: { tcp: number[]; udp: number[] };
  leftovers: string[];
  wipeFormerIdentity: boolean;
}

export interface ImportStepState {
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  message?: string;
  bytes?: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface ImportSelectionView {
  id: string;
  status: ImportStatus;
  discoveryId: string;
  selections: ImportSelections;
  joinPlan: JoinPlan;
  planId: string | null;
  steps: Record<string, ImportStepState>;
  released: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportDiscoveryReport {
  hostname: string;
  docker: { available: boolean; version?: string };
  listeners: { protocol: 'tcp' | 'udp'; address: string; port: number; process?: string }[];
  interfaces: { name: string; kind: string; up: boolean; addresses: string[] }[];
  vpns: { interface: string; kind: string; listenPort?: number }[];
  composeProjects: {
    name: string;
    envFile?: { path: string; variables: { name: string; value?: string; sensitive: boolean }[] };
    configFiles: { path: string; redacted?: { variable: string; path: string }[]; error?: string }[];
  }[];
  former: { clusterId?: string; nodeName?: string; drbdResources: { name: string }[] } | null;
  warnings: string[];
}

export interface ImportDetail {
  node: string;
  lifecycle: string;
  connected: boolean;
  discovery: {
    id: string;
    source: string;
    receivedAt: string;
    requestedAt: string | null;
    report: ImportDiscoveryReport;
  };
  items: DiscoveredItem[];
  projects: string[];
  selection: ImportSelectionView | null;
}
