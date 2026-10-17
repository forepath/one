import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/** Scheduler state per kind of control-plane backup (3.20): last run, its outcome, and the run lease. */
@Entity('lw_platform_backup_state')
export class PlatformBackupStateEntity {
  /** `postgres`, `opensearch` or `etcd`. */
  @PrimaryColumn({ type: 'varchar', length: 16, name: 'kind' })
  kind!: string;

  /** When the scheduler first saw this kind (the first run waits for the first scheduled time after it). */
  @Column({ type: 'timestamptz', name: 'first_seen_at' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz', name: 'last_started_at', nullable: true })
  lastStartedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_finished_at', nullable: true })
  lastFinishedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, name: 'last_status', nullable: true })
  lastStatus!: 'succeeded' | 'failed' | 'unavailable' | null;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;

  @Column({ type: 'varchar', length: 128, name: 'last_backup', nullable: true })
  lastBackup!: string | null;

  /** Lease of a running backup / retention (another replica doesn't start one meanwhile). */
  @Column({ type: 'timestamptz', name: 'running_until', nullable: true })
  runningUntil!: Date | null;
}

/**
 * A temporary delete grant for a gateway client (3.20): only while the control plane's retention runs, WAL-G
 * (`wal-g delete before` / `delete target`) or OpenSearch (snapshot deletion) may delete under `prefix`, through the gateway.
 */
@Entity('lw_platform_backup_grants')
export class PlatformBackupGrantEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 16, name: 'role' })
  role!: 'postgres' | 'opensearch';

  @Column({ type: 'varchar', length: 512, name: 'prefix' })
  prefix!: string;

  @Column({ type: 'varchar', length: 64, name: 'reason' })
  reason!: string;

  /**
   * The exact keys the grant allows deleting (M6 review L4; WAL-G retention / deletion, computed from a listing
   * before the run); null: every key under `prefix` (OpenSearch, whose snapshot deletion names blobs the control
   * plane cannot predict).
   */
  @Column({ type: 'jsonb', name: 'keys', nullable: true })
  keys!: string[] | null;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** `adopted`: the clone became the control-plane database (cut-over). */
export type PlatformRestoreState = 'requested' | 'restoring' | 'ready' | 'failed' | 'discarded' | 'adopted';

/**
 * Point-in-time restore of the control-plane database (3.20): a clone into its own Patroni scope on one member,
 * started through the member's desired state; the cut-over is a separate, documented step.
 */
@Entity('lw_platform_restores')
export class PlatformRestoreEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: 'postgres';

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: PlatformRestoreState;

  @Column({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  @Column({ type: 'varchar', length: 63, name: 'scope' })
  scope!: string;

  @Column({ type: 'varchar', length: 63, name: 'source_scope' })
  sourceScope!: string;

  /** Null: the end of the archive. */
  @Column({ type: 'timestamptz', name: 'target_time', nullable: true })
  targetTime!: Date | null;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'requested_by' })
  requestedBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'ready_at', nullable: true })
  readyAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;
}
