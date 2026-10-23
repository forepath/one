/**
 * Backups (3.20): `GET /backups/status`, the catalog (`GET /backups`), file browsing and diff, restore tests, restores
 * (`Restore` resources, created through plans), deletion requests (second admin + delay) and the backup key with its
 * recovery kit (cluster admins).
 */

export type BackupRunStatus = 'running' | 'succeeded' | 'failed';

/** A copy of a backup on a target (`garage` = the cluster's own object store) and its object lock. */
export interface BackupTargetCopy {
  target: string;
  copiedAt: string;
  lockedUntil: string | null;
}

export type RestoreTestStatus = 'running' | 'passed' | 'failed';

/** One backup (Kopia snapshot) of a volume: `resource` is `<project>/<deployment>/<volume>`. */
export interface Backup {
  id: string;
  /** `cluster` or `project-<name>` (the Kopia repository). */
  scope: string;
  project: string | null;
  resource: string;
  policy: string | null;
  node: string | null;
  status: BackupRunStatus;
  snapshotId: string | null;
  keyGeneration: number;
  /** Logical size of the snapshot. */
  bytes: number;
  /** What the backup added to the repository (after deduplication). */
  uploadedBytes: number;
  files: number;
  targets: BackupTargetCopy[];
  /** Retention keep reasons at the last evaluation (`latest`, `daily`, …). */
  keep: string[];
  hooks: boolean;
  encrypted: boolean;
  /** Immutable (object lock) until, or null. */
  lockedUntil: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  deletedAt: string | null;
  /** The latest restore test of this backup. */
  restoreTest: { id: string; status: RestoreTestStatus; finishedAt: string | null } | null;
}

export interface BackupsStatus {
  keys: { generation: number | null; kitConfirmed: boolean; escrowed: boolean };
  /** Cluster pins: backups not recoverable (kit), no off-cluster copy. */
  pins: string[];
  repositories: { scope: string; port: number; fingerprint: string; keyGeneration: number }[];
  targets: { target: string; scope: string; at: string; ok: boolean; error?: string }[];
  /** Live, successful backups per project (what counts against storage quotas). */
  usage: { project: string; bytes: number; uploadedBytes: number; backups: number }[];
  deletionDelayHours: number;
}

export interface BackupCatalogQuery {
  project?: string | null;
  /** A volume: `<project>/<deployment>/<volume>`. */
  resource?: string | null;
  includeDeleted?: boolean;
  limit?: number;
}

/** One entry of a backup directory (`GET /backups/{id}/files?path=`). */
export interface BackupFileEntry {
  name: string;
  directory: boolean;
  mode: string;
  size: number;
  modified: string;
  object: string;
}

/** Changed files between two backups of the same volume (`GET /backups/diff?from=&to=`). */
export interface BackupDiff {
  added: { path: string; size: number | null; directory: boolean }[];
  removed: { path: string; size: number | null; directory: boolean }[];
  changed: { path: string; before: number | null; after: number | null }[];
  stats: Record<string, unknown> | null;
}

export interface RestoreTest {
  id: string;
  backupId: string;
  project: string | null;
  resource: string;
  node: string | null;
  status: RestoreTestStatus;
  keyGeneration: number;
  check: { command: string[] | null; exitCode: number | null; output: string } | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type RestoreRunStatus = 'pending' | 'running' | 'done' | 'failed';

/** The execution of a `Restore` resource (once per generation) with live progress. */
export interface BackupRestore {
  id: string;
  project: string;
  /** The `Restore` resource's name. */
  name: string;
  generation: number;
  backupId: string;
  /** Target volume id. */
  volume: string;
  kind: 'volume' | 'path' | string;
  status: RestoreRunStatus;
  node: string | null;
  progress: { phase?: string; bytes?: number; files?: number } | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export type BackupDeletionState = 'pending' | 'approved' | 'executed' | 'cancelled';

/** Deleting backups or shortening retention: a second admin approves, it takes effect after `notBefore`. */
export interface BackupDeletion {
  id: string;
  kind: 'backups' | 'retention';
  scope: string;
  backupIds: string[];
  retention: { policy: string; project: string | null; spec: Record<string, unknown> } | null;
  reason: string;
  state: BackupDeletionState;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  notBefore: string;
  executedAt: string | null;
  createdAt: string;
}

export type BackupDeletionAction = 'approve' | 'cancel';

/** A generation of the backup key with its recovery kit (Shamir shares) and optional KMS escrow. */
export interface BackupKeyGeneration {
  generation: number;
  rootId: string;
  active: boolean;
  createdAt: string;
  retiredAt: string | null;
  kit: {
    shares: number;
    threshold: number;
    downloaded: { index: number; downloadedAt: string | null; downloadedBy: string | null }[];
    confirmedAt: string | null;
    confirmedBy: string | null;
  };
  escrow: { provider: string; keyRef: string; at: string } | null;
}

/** A recovery-kit size: `shares` (n) of which `threshold` (k) recover the key. */
export interface KitSize {
  shares: number;
  threshold: number;
}

/** The default kit size the console offers (2 of 3). */
export const DEFAULT_KIT_SIZE: KitSize = { shares: 3, threshold: 2 };

/** One share of a recovery kit, handed out exactly once. */
export interface KitShare {
  document: {
    format: string;
    version: number;
    cluster: string;
    generation: number;
    rootId: string;
    index: number;
    shares: number;
    threshold: number;
    share: string;
    createdAt: string;
    checksum: string;
  };
  /** The share as printable text (what is saved and later pasted back). */
  text: string;
}

export type BackupKeyAction = 'rotate' | 'reissue' | 'share' | 'confirm' | 'escrow';

/** How a restore writes into an existing volume. */
export type RestoreMode = 'replace' | 'merge';

/** The restore wizard's result: what the `Restore` resource declares. */
export interface RestoreRequest {
  backup: Pick<Backup, 'id' | 'project'>;
  deployment: string;
  volume: string;
  mode: RestoreMode;
  /** Single-file restore: this file / directory of the backup (relative). */
  path?: string;
  /** Where `path` goes in the volume (default: the same path). */
  targetPath?: string;
  overwrite?: boolean;
  description?: string;
}

/*
 * Control-plane ("platform") backups and disaster recovery (M6): the cluster's own Postgres (point-in-time recovery,
 * cut-over), OpenSearch and etcd, the external copy to off-cluster targets and the DR info document.
 */

export type PlatformBackupKind = 'postgres' | 'opensearch' | 'etcd';

export interface PlatformBackupKindSettings {
  enabled: boolean;
  schedule: string;
  keep: number;
}

/** One backup of a platform kind and its copies on external targets. */
export interface PlatformBackupEntry {
  id: string;
  name: string | null;
  status: string;
  bytes: number;
  startedAt: string;
  finishedAt: string | null;
  targets: BackupTargetCopy[];
}

/** A shorter retention waits for a second admin and the deletion delay. */
export interface PlatformRetentionRequest {
  id: string;
  keep: number;
  state: string;
  requestedBy: string;
  approvedBy: string | null;
  notBefore: string;
}

export interface PlatformBackupKindStatus {
  kind: PlatformBackupKind;
  enabled: boolean;
  schedule: string;
  /** Declared retention. */
  keep: number;
  /** Retention in effect (differs while a shorter one waits for approval / the delay). */
  effectiveKeep: number;
  retentionRequest: PlatformRetentionRequest | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastBackup: string | null;
  running: boolean;
  backups: PlatformBackupEntry[];
}

export type PlatformRestoreState = 'requested' | 'restoring' | 'ready' | 'failed' | 'discarded' | 'adopted';

/** A point-in-time restore of the control-plane Postgres into a separate scope (`/backups/platform/postgres/restores`). */
export interface PlatformRestore {
  id: string;
  kind: 'postgres';
  state: PlatformRestoreState;
  node: string;
  scope: string;
  sourceScope: string;
  targetTime: string | null;
  error: string | null;
  requestedBy: string;
  createdAt: string;
  readyAt: string | null;
  finishedAt: string | null;
  endpoint: { host: string | null; port: number; patroniPort: number };
}

/** The external copy to one off-cluster target. */
export interface PlatformCopyTarget {
  target: string;
  type: 's3' | 'sftp' | null;
  declared: boolean;
  objectLock: { mode: string; days: number } | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  objects: number;
  bytes: number;
  /** The newest DR envelope read back from the target and decrypted. */
  verifiedEnvelope: string | null;
  verifiedAt: string | null;
}

/** `GET /backups/platform`. */
export interface PlatformBackupStatus {
  enabled: boolean;
  gateway: boolean;
  settings: {
    enabled: boolean;
    timeZone: string;
    postgres: PlatformBackupKindSettings;
    opensearch: PlatformBackupKindSettings;
    etcd: PlatformBackupKindSettings;
    targets?: string[];
  };
  kinds: PlatformBackupKindStatus[];
  /** The point-in-time recovery window of the control-plane Postgres. */
  postgresWindow: { from: string | null; to: string } | null;
  postgresScope: string;
  restores: PlatformRestore[];
  copies: PlatformCopyTarget[];
  pins: string[];
  deletionDelayHours: number;
}

/** `POST /backups/platform/:kind/run`. */
export interface PlatformBackupRunResult {
  kind: PlatformBackupKind;
  status: 'succeeded' | 'failed' | 'unavailable' | 'busy';
  backup: string | null;
  bytes: number;
  error: string | null;
  deleted: string[];
}

export interface PlatformRestoreRequest {
  /** ISO 8601 with offset; omitted = the newest state. */
  targetTime?: string;
  node?: string;
}

export type PlatformCutoverState = 'planned' | 'approved' | 'switching' | 'done' | 'failed' | 'cancelled';

/** Switching the control-plane database to a ready restore: planned, approved by a second admin, then executed. */
export interface PlatformCutover {
  id: string;
  restoreId: string;
  state: PlatformCutoverState;
  node: string;
  scope: string;
  previousScope: string;
  targetTime: string | null;
  plan: { steps: string[]; warnings: string[]; members: string[]; dataLossAfter: string };
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  finalBackup: string | null;
  error: string | null;
  createdAt: string;
  switchedAt: string | null;
  finishedAt: string | null;
}

export type PlatformCutoverAction = 'approve' | 'cancel';

/** `POST /backups/platform/copies/run`: one entry per target. */
export interface PlatformCopyRunResult {
  target: string;
  status: 'succeeded' | 'failed';
  copied: number;
  pruned: number;
  error: string | null;
}

/** `GET /backups/platform/dr-info`: no secrets, only target locations and key generations. */
export interface DrInfoDocument {
  format: 'loadweaver-dr-info';
  version: 1;
  clusterId: string;
  postgresScope: string;
  createdAt: string;
  targets: {
    name: string;
    type: 's3' | 'sftp';
    endpoint?: string;
    bucket?: string;
    region?: string;
    prefix?: string;
    objectLock?: { mode: string; days: number } | null;
    host?: string;
    port?: number;
    user?: string;
    path?: string;
    knownHosts?: string;
    credentialsRef: string;
  }[];
  keys: {
    generation: number;
    rootId: string;
    kitShares: number;
    kitThreshold: number;
    kitConfirmed: boolean;
    active: boolean;
    escrow: { provider: string; keyRef: string; wrapped: string } | null;
  }[];
}

/** `POST /backups/platform/opensearch/restore`. */
export interface PlatformOpensearchRestoreRequest {
  snapshot: string;
  indices: string[];
  renamePrefix?: string;
}
