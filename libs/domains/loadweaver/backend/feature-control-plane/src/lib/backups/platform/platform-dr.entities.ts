import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

function bigintTransformer() {
  return {
    to: (value: number | null | undefined) => value,
    from: (value: string | number | null) => (value === null ? 0 : Number(value)),
  };
}

/**
 * One object of the platform bucket copied to an external target (3.20): encrypted on the control plane before it
 * leaves (the target never sees plaintext), verified after the upload. `etag` is the source object's, so a rewritten
 * object (OpenSearch's `index.latest`, a re-sealed DR envelope) is copied again.
 */
@Entity('lw_platform_copies')
export class PlatformCopyEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'target' })
  target!: string;

  @PrimaryColumn({ type: 'varchar', length: 1024, name: 'key' })
  key!: string;

  @Column({ type: 'varchar', length: 128, name: 'etag' })
  etag!: string;

  /** Plaintext size (the source object's). */
  @Column({ type: 'bigint', name: 'size', transformer: bigintTransformer() })
  size!: number;

  /** Size on the target (header + chunk tags), checked after every upload. */
  @Column({ type: 'bigint', name: 'stored_size', transformer: bigintTransformer() })
  storedSize!: number;

  /** Backup-key generation the copy is encrypted under. */
  @Column({ type: 'integer', name: 'generation' })
  generation!: number;

  @Column({ type: 'timestamptz', name: 'copied_at' })
  copiedAt!: Date;

  /** Object lock on the target (compliance / governance retention), or null. */
  @Column({ type: 'timestamptz', name: 'locked_until', nullable: true })
  lockedUntil!: Date | null;
}

/** State of the external copy per target (3.20): last pass, its outcome, what it holds. */
@Entity('lw_platform_copy_targets')
export class PlatformCopyTargetEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'target' })
  target!: string;

  @Column({ type: 'timestamptz', name: 'last_started_at', nullable: true })
  lastStartedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_finished_at', nullable: true })
  lastFinishedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, name: 'last_status', nullable: true })
  lastStatus!: 'succeeded' | 'failed' | null;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;

  @Column({ type: 'integer', name: 'objects', default: 0 })
  objects!: number;

  @Column({ type: 'bigint', name: 'bytes', default: 0, transformer: bigintTransformer() })
  bytes!: number;

  /** Newest DR envelope on the target that was read back and opened with the backup key (deep verification). */
  @Column({ type: 'varchar', length: 160, name: 'verified_envelope', nullable: true })
  verifiedEnvelope!: string | null;

  @Column({ type: 'timestamptz', name: 'verified_at', nullable: true })
  verifiedAt!: Date | null;
}

export type PlatformCutoverState = 'planned' | 'approved' | 'switching' | 'done' | 'failed' | 'cancelled';

/** The plan of a cut-over as shown before the approval. */
export interface PlatformCutoverPlan {
  steps: string[];
  warnings: string[];
  members: string[];
  /** Everything written after this time is lost (the clone's target time, or when it was restored). */
  dataLossAfter: string;
}

/**
 * Cut-over of the control-plane database to a ready point-in-time clone (3.20): a plan a cluster admin requests and
 * a second cluster admin approves. Also written into the clone's own database before the switch, so the control
 * plane running on the clone afterwards knows the scope and finishes the cut-over.
 */
@Entity('lw_platform_cutovers')
export class PlatformCutoverEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'restore_id' })
  restoreId!: string;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: PlatformCutoverState;

  /** Member running the clone; it adopts the clone as its database. */
  @Column({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  /** Patroni scope after the cut-over (the clone's). */
  @Column({ type: 'varchar', length: 63, name: 'scope' })
  scope!: string;

  @Column({ type: 'varchar', length: 63, name: 'previous_scope' })
  previousScope!: string;

  @Column({ type: 'timestamptz', name: 'target_time', nullable: true })
  targetTime!: Date | null;

  @Column({ type: 'jsonb', name: 'plan' })
  plan!: PlatformCutoverPlan;

  @Column({ type: 'varchar', length: 255, name: 'requested_by' })
  requestedBy!: string;

  @Column({ type: 'varchar', length: 255, name: 'approved_by', nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'approved_at', nullable: true })
  approvedAt!: Date | null;

  /** Final base backup of the old timeline, taken right before the switch (kept under the previous scope). */
  @Column({ type: 'varchar', length: 128, name: 'final_backup', nullable: true })
  finalBackup!: string | null;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'switched_at', nullable: true })
  switchedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;
}

export type DrRecoveryState = 'started' | 'key-restored' | 'completed';

/**
 * A whole-cluster disaster recovery (3.20) as the restored control plane runs it: previous nodes marked lost, the
 * object store formed anew, Kopia repositories re-seeded from the external copy, volumes restored. One row per
 * `loadweaver-agent bootstrap --restore`.
 */
@Entity('lw_dr_recoveries')
export class DrRecoveryEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id!: string;

  /** The fresh node the cluster was restored on. */
  @Column({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: DrRecoveryState;

  /** Nodes of the cluster before the loss (marked left; they re-join with a new token). */
  @Column({ type: 'jsonb', name: 'previous_nodes', default: () => "'[]'" })
  previousNodes!: string[];

  /** Kopia repositories to re-seed from an external target: scope → `pending` / `done` / `missing` / error. */
  @Column({ type: 'jsonb', name: 'reseed', default: () => "'{}'" })
  reseed!: Record<string, string>;

  /** Volumes restored from their newest backup: volume id → restore id (or why not). */
  @Column({ type: 'jsonb', name: 'volumes', default: () => "'{}'" })
  volumes!: Record<string, string>;

  /** Restore volumes automatically once their repository is back (`--no-volume-restore` turns it off). */
  @Column({ type: 'boolean', name: 'restore_volumes', default: true })
  restoreVolumes!: boolean;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'key_restored_at', nullable: true })
  keyRestoredAt!: Date | null;

  /** When the workloads and volumes were placed again on the nodes that exist (after the restoring node joined). */
  @Column({ type: 'timestamptz', name: 'replanned_at', nullable: true })
  replannedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt!: Date | null;
}
