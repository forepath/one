import { createAes256GcmTransformer } from '@forepath/shared/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** A recovery-kit share waiting for its one download, sealed under a key derived from the generation's root key. */
export interface BackupKitShare {
  index: number;
  /** `seal(kitKey, encodedShare)` as base64; null once downloaded (download once). */
  sealed: string | null;
  downloadedAt: string | null;
  downloadedBy: string | null;
}

/** Root key escrowed in the configured KMS / Vault (3.20 "optionally also escrowed"). */
export interface BackupKeyEscrow {
  provider: string;
  keyRef: string;
  wrapped: string;
  at: string;
}

/**
 * One generation of the backup key hierarchy (3.20), separate from the cluster's secrets: a random root key,
 * envelope-encrypted with the master key (re-wrapped on every master-key change like secrets), split into the
 * recovery kit and optionally escrowed in a KMS. Data keys and repository passwords are derived from the root.
 * Old generations stay for restores.
 */
@Entity('lw_backup_keys')
export class BackupKeyEntity {
  @PrimaryColumn({ type: 'integer', name: 'generation' })
  generation!: number;

  /** Id of the root key (first 8 bytes of SHA-256), carried by every kit share. */
  @Column({ type: 'varchar', length: 16, name: 'root_id' })
  rootId!: string;

  /** Master key that wraps `wrapped_key`. */
  @Column({ type: 'varchar', length: 16, name: 'key_id' })
  keyId!: string;

  @Column({ type: 'bytea', name: 'wrapped_key' })
  wrappedKey!: Buffer;

  @Column({ type: 'bytea', name: 'ciphertext' })
  ciphertext!: Buffer;

  @Column({ type: 'boolean', name: 'active', default: false })
  active!: boolean;

  @Column({ type: 'integer', name: 'kit_shares' })
  kitShares!: number;

  @Column({ type: 'integer', name: 'kit_threshold' })
  kitThreshold!: number;

  @Column({ type: 'jsonb', name: 'kit', default: () => "'[]'" })
  kit!: BackupKitShare[];

  @Column({ type: 'timestamptz', name: 'kit_confirmed_at', nullable: true })
  kitConfirmedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, name: 'kit_confirmed_by', nullable: true })
  kitConfirmedBy!: string | null;

  @Column({ type: 'jsonb', name: 'escrow', nullable: true })
  escrow!: BackupKeyEscrow | null;

  @Column({ type: 'timestamptz', name: 'retired_at', nullable: true })
  retiredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type BackupStatus = 'running' | 'succeeded' | 'failed';

/** One snapshot in the catalog (3.20): a volume (or file set) of a node, in a repository on a target. */
@Entity('lw_backups')
@Index('IDX_lw_backups_resource', ['scope', 'resource', 'startedAt'])
export class BackupEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** Repository = trust boundary: `cluster` or `project-<name>`. */
  @Column({ type: 'varchar', length: 128, name: 'scope' })
  scope!: string;

  @Column({ type: 'varchar', length: 128, name: 'project', nullable: true })
  project!: string | null;

  /** What was backed up: the volume id `<project>/<deployment>/<volume>`. */
  @Column({ type: 'varchar', length: 512, name: 'resource' })
  resource!: string;

  @Column({ type: 'varchar', length: 255, name: 'policy', nullable: true })
  policy!: string | null;

  @Column({ type: 'varchar', length: 128, name: 'node', nullable: true })
  node!: string | null;

  @Column({ type: 'varchar', length: 32, name: 'status' })
  status!: BackupStatus;

  /** Kopia snapshot id (manifest id). */
  @Column({ type: 'varchar', length: 128, name: 'snapshot_id', nullable: true })
  snapshotId!: string | null;

  /** Kopia root object (`k…`): what restores, diffs and the file browser address. */
  @Column({ type: 'varchar', length: 160, name: 'root_object', nullable: true })
  rootObject!: string | null;

  @Column({ type: 'integer', name: 'key_generation' })
  keyGeneration!: number;

  @Column({ type: 'bigint', name: 'bytes', default: 0, transformer: bigintTransformer() })
  bytes!: number;

  /** Bytes actually uploaded (after dedup / compression). */
  @Column({ type: 'bigint', name: 'uploaded_bytes', default: 0, transformer: bigintTransformer() })
  uploadedBytes!: number;

  @Column({ type: 'integer', name: 'files', default: 0 })
  files!: number;

  /** Targets holding a copy: `garage` + external targets after their secondary copy. */
  @Column({ type: 'jsonb', name: 'targets', default: () => "'[]'" })
  targets!: Array<{ target: string; copiedAt: string; lockedUntil: string | null }>;

  /** Retention keep reasons at the last evaluation (`latest`, `daily`, ...). */
  @Column({ type: 'jsonb', name: 'keep', default: () => "'[]'" })
  keep!: string[];

  @Column({ type: 'boolean', name: 'hooks', default: false })
  hooks!: boolean;

  /** Non-secret part of the node command (hooks, tags); credentials are added when it is sent. */
  @Column({ type: 'jsonb', name: 'command', nullable: true })
  command!: Record<string, unknown> | null;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  /** Set when the deletion took effect (retention or approved deletion); the row stays for the timeline. */
  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}

export type BackupDeletionState = 'pending' | 'approved' | 'executed' | 'cancelled';

/**
 * Deleting backups or shortening retention (3.20): needs a second admin's approval and takes effect only after
 * a delay (72 h default).
 */
@Entity('lw_backup_deletions')
export class BackupDeletionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** `backups` (explicit ids) or `retention` (a policy change that drops snapshots). */
  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: 'backups' | 'retention';

  @Column({ type: 'varchar', length: 128, name: 'scope' })
  scope!: string;

  @Column({ type: 'jsonb', name: 'backup_ids', default: () => "'[]'" })
  backupIds!: string[];

  /** For `retention`: the policy and the retention that applies once executed. */
  @Column({ type: 'jsonb', name: 'retention', nullable: true })
  retention!: { policy: string; project: string | null; spec: Record<string, unknown> } | null;

  @Column({ type: 'text', name: 'reason' })
  reason!: string;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: BackupDeletionState;

  @Column({ type: 'varchar', length: 255, name: 'requested_by' })
  requestedBy!: string;

  @Column({ type: 'varchar', length: 255, name: 'approved_by', nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'approved_at', nullable: true })
  approvedAt!: Date | null;

  /** Earliest execution: request time + delay. */
  @Column({ type: 'timestamptz', name: 'not_before' })
  notBefore!: Date;

  @Column({ type: 'timestamptz', name: 'executed_at', nullable: true })
  executedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type RestoreTestStatus = 'running' | 'passed' | 'failed';

/** Automated restore test (3.20): restore into a scratch volume, run the check hook, report. */
@Entity('lw_restore_tests')
@Index('IDX_lw_restore_tests_resource', ['resource', 'startedAt'])
export class RestoreTestEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'backup_id' })
  backupId!: string;

  @Column({ type: 'varchar', length: 128, name: 'scope' })
  scope!: string;

  @Column({ type: 'varchar', length: 128, name: 'project', nullable: true })
  project!: string | null;

  @Column({ type: 'varchar', length: 512, name: 'resource' })
  resource!: string;

  @Column({ type: 'varchar', length: 128, name: 'node', nullable: true })
  node!: string | null;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: RestoreTestStatus;

  /** Proves the kit / key generation still decrypts current backups (3.20). */
  @Column({ type: 'integer', name: 'key_generation' })
  keyGeneration!: number;

  @Column({ type: 'jsonb', name: 'check', nullable: true })
  check!: { command: string[] | null; exitCode: number | null; output: string } | null;

  /** Non-secret part of the node command (size, check hook). */
  @Column({ type: 'jsonb', name: 'command', nullable: true })
  command!: Record<string, unknown> | null;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;
}

/**
 * A Kopia repository (one per trust boundary) and its servers on the members: port, TLS certificate (cluster CA,
 * pinned by fingerprint), and the backup-key generation its passwords derive from.
 */
@Entity('lw_backup_repositories')
export class BackupRepositoryEntity {
  @PrimaryColumn({ type: 'varchar', length: 80, name: 'scope' })
  scope!: string;

  @Column({ type: 'integer', name: 'port', unique: true })
  port!: number;

  @Column({ type: 'integer', name: 'key_generation' })
  keyGeneration!: number;

  @Column({ type: 'text', name: 'certificate' })
  certificate!: string;

  @Column({ type: 'text', name: 'private_key', transformer: createAes256GcmTransformer() })
  privateKey!: string;

  @Column({ type: 'varchar', length: 64, name: 'fingerprint' })
  fingerprint!: string;

  /** Kopia users created on the servers (`user@host`), so each is added once. */
  @Column({ type: 'jsonb', name: 'users', default: () => "'[]'" })
  users!: string[];

  @Column({ type: 'timestamptz', name: 'ready_at', nullable: true })
  readyAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type RestoreStatus = 'pending' | 'running' | 'done' | 'failed';

/** Execution of a `Restore` resource (once per generation), with live progress (3.19 / 3.20). */
@Entity('lw_restores')
@Index('UQ_lw_restores_resource', ['project', 'name', 'generation'], { unique: true })
export class RestoreEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 128, name: 'project' })
  project!: string;

  @Column({ type: 'varchar', length: 128, name: 'name' })
  name!: string;

  @Column({ type: 'integer', name: 'generation' })
  generation!: number;

  @Column({ type: 'uuid', name: 'backup_id' })
  backupId!: string;

  /** Target volume id. */
  @Column({ type: 'varchar', length: 512, name: 'volume' })
  volume!: string;

  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: 'volume' | 'path';

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: RestoreStatus;

  @Column({ type: 'varchar', length: 128, name: 'node', nullable: true })
  node!: string | null;

  @Column({ type: 'jsonb', name: 'progress', nullable: true })
  progress!: { phase?: string; bytes?: number; files?: number } | null;

  /** Non-secret part of the node command (mode, paths). */
  @Column({ type: 'jsonb', name: 'command', nullable: true })
  command!: Record<string, unknown> | null;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * The retention a policy currently runs with. Longer retention applies at once; a shorter one only after a second
 * admin approved it and the delay passed (3.20), until then the previous (longer) one stays effective.
 */
@Entity('lw_backup_retention')
export class BackupRetentionEntity {
  /** `<project>/<policy>` or `cluster/<policy>`. */
  @PrimaryColumn({ type: 'varchar', length: 300, name: 'policy' })
  policy!: string;

  @Column({ type: 'jsonb', name: 'effective' })
  effective!: Record<string, number>;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

function bigintTransformer() {
  return {
    to: (value: number | null | undefined) => value,
    from: (value: string | number | null) => (value === null ? 0 : Number(value)),
  };
}
