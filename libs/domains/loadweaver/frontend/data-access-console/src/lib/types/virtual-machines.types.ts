/** Full virtual machines (3.35): what `GET /virtual-machines`, `/projects/:p/virtual-machines/:name` return. */

export type VmPhase =
  | 'Pending'
  | 'Importing'
  | 'Starting'
  | 'Running'
  | 'Stopping'
  | 'Stopped'
  | 'Migrating'
  | 'Failed';
export type VmRunStrategy = 'Always' | 'Manual' | 'Halted';
export type VmPowerState = 'running' | 'stopped';
export type VmAction = 'start' | 'stop' | 'force-off' | 'shutdown' | 'reboot' | 'reset' | 'reimage';
export type VmConsoleKind = 'serial' | 'vnc';
export type VmImportPhase = 'queued' | 'fetching' | 'writing' | 'failed';

/** The boot disk import on the node: bytes downloaded (`fetching`) or written of `totalBytes` (`writing`). */
export interface VmImportProgress {
  phase: VmImportPhase;
  bytes?: number;
  totalBytes?: number;
}

export interface VirtualMachineSummary {
  project: string;
  name: string;
  labels: Record<string, string>;
  description: string | null;
  image: string;
  pinnedImage: string | null;
  runStrategy: VmRunStrategy;
  power: VmPowerState;
  phase: VmPhase;
  node: string | null;
  vcpus: number;
  memoryBytes: number;
  diskBytes: number;
  disks: number;
  nics: number;
  addresses: string[];
  graphical: boolean;
  invalid?: string;
  /** While the node reports a boot disk import. */
  importProgress?: VmImportProgress;
}

export interface VmNicStatus {
  name: string;
  index: number;
  primary: boolean;
  mac: string;
  groups: string[];
  labels: Record<string, string>;
  families: ('v4' | 'v6')[];
  addresses: string[];
}

export interface VmDiskStatus {
  name: string;
  volume: string;
  source: 'image' | 'blank';
  boot: boolean;
  sizeBytes: number;
  bus: string;
  cache: string;
  replicas: number | null;
  crossSite: string | null;
  primaryNode: string | null;
  syncReplicas: string[];
  remoteReplicas: string[];
}

export interface VmConsoleAvailability {
  available: boolean;
  reason?: string;
}

export interface VmCommand {
  id: string;
  type: 'vmPower' | 'vmImageImport';
  /** `reboot`, `reset`, `shutdown`, `destroy` (force-off) or `reimage`. */
  action: string;
  node: string;
  /** The node reports the outcome: sent → (running →) succeeded / failed. */
  status: 'pending' | 'sent' | 'running' | 'succeeded' | 'failed';
  error: string | null;
  requestedBy: string | null;
  /** Resolved server-side (`null`: deleted user / not a user); the console shows it instead of the id (D11). */
  requestedByEmail?: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface VirtualMachineDetail extends VirtualMachineSummary {
  spec: Record<string, unknown> | null;
  generation: number;
  updatedAt: string;
  status: {
    phase: VmPhase;
    node: string | null;
    state: string | null;
    /** Guest power from the launcher (`running`, `paused`, `shutting-down`, `shut-off`, `crashed`, ...). */
    guestPower: string | null;
    importing: boolean;
    importProgress?: VmImportProgress | null;
    message: string | null;
    exitCode: number | null;
    reportedAt: string | null;
    lastBoot: string | null;
    migration: { targetNode: string | null } | null;
  };
  powerDetail: {
    graceful: boolean;
    changedBy: string | null;
    changedByEmail?: string | null;
    changedAt: string | null;
    instanceGeneration: number;
  };
  nicStatus: VmNicStatus[];
  diskStatus: VmDiskStatus[];
  consoles: {
    replica: string;
    namespace: 'socket/consoles';
    serial: VmConsoleAvailability;
    vnc: VmConsoleAvailability;
  };
  actions: VmAction[];
  permissions: { power: boolean; snapshot: boolean; console: boolean; edit: boolean };
  commands: VmCommand[];
}

export interface VmSnapshot {
  id: string;
  project: string;
  name: string;
  description: string | null;
  consistency: 'crash' | 'application';
  status: 'running' | 'succeeded' | 'failed' | 'partial';
  createdBy: string | null;
  createdAt: string;
  disks: {
    disk: string;
    backupId: string;
    status: string | null;
    bytes: number | null;
    error: string | null;
    finishedAt: string | null;
  }[];
}

export interface VmImageImport {
  id: string;
  project: string;
  repository: string;
  tag: string;
  reference: string;
  url: string;
  sha256: string | null;
  /** Set instead of `sha256` for SHA-512 imports (3.42). */
  sha512: string | null;
  arch: 'amd64' | 'arm64';
  firmware: ('uefi' | 'bios')[];
  guestAgent: boolean;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  step: string | null;
  format: 'qcow2' | 'raw' | null;
  containerDisk: boolean;
  downloadedBytes: number;
  virtualSize: number | null;
  digest: string | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** A VM image artifact in the project's registry (pushed with `loadweaver vm-image push`, an OCI client or imported). */
export interface VmRegistryImage {
  project: string;
  repository: string;
  tag: string;
  /** `registry.lw/<project>/<repository>:<tag>@<digest>`. */
  reference: string;
  digest: string;
  variants: {
    arch: 'amd64' | 'arm64';
    format: 'qcow2' | 'raw';
    virtualSize: number;
    firmware: ('uefi' | 'bios')[];
    guestAgent: boolean;
    layerBytes: number;
  }[];
}

/** Exactly one of `sha256` / `sha512` (3.42: some distros publish SHA-512 only). */
export interface VmImageImportRequest {
  url: string;
  sha256?: string;
  sha512?: string;
  ref: string;
  arch?: 'amd64' | 'arm64';
  firmware?: ('uefi' | 'bios')[];
  guestAgent?: boolean;
}

/**
 * One entry of the VM image catalog (3.42): `shipped` (the release's recommended images), `cluster` (the cluster
 * admins' own, `Cluster.spec.vmImages.catalog`) or `upstream` (the distros' current builds, read on demand).
 */
export interface VmImageCatalogEntry {
  id: string;
  source: 'shipped' | 'cluster' | 'upstream';
  distro: string;
  label: string;
  version: string;
  arch: 'amd64' | 'arm64';
  url: string;
  checksum: { algorithm: 'sha256' | 'sha512'; value: string };
  firmware?: ('uefi' | 'bios')[];
  guestAgent?: boolean;
  description?: string;
  /** `<repository>:<tag>` to import it as (e.g. `ubuntu:24.04`). */
  suggestedRef: string;
  /** The distro's build id (upstream entries). */
  build?: string;
}

/** `GET /vm-images/catalog`: shipped and cluster entries. */
export interface VmImageCatalog {
  entries: VmImageCatalogEntry[];
}

/** `GET /vm-images/catalog/upstream`: the live lookup; sources that couldn't be read are warnings. */
export interface VmImageUpstreamCatalog {
  entries: VmImageCatalogEntry[];
  warnings: string[];
}

/** Events of a `socket/consoles` connection, as the console socket client emits them. */
export type VmConsoleSocketEvent =
  | { type: 'connection'; connected: boolean; error?: string }
  | { type: 'opened'; sessionId: string; kind: VmConsoleKind; recorded: boolean }
  | { type: 'output'; sessionId: string; data: string | ArrayBuffer }
  | { type: 'closed'; sessionId: string; exitCode: number | null; error?: string }
  | { type: 'error'; sessionId?: string; message: string };
