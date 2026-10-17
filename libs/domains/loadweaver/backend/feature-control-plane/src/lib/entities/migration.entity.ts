import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { MigrationMethod } from '../utils/migration-eligibility.utils';
import type { SessionReports } from '../utils/migration-state.utils';

/**
 * Migration history (3.10): one row per attempt of moving a replica. A live attempt that falls back ends with
 * phase `fallback` and its reason; the short-stop / blue-green attempt that follows has the next attempt number.
 * Checkpoint attempts (`live`, `stop-and-copy`) are also the session record the commands are derived from.
 */
@Entity('lw_migrations')
@Index('IDX_lw_migrations_replica', ['replica', 'startedAt'])
@Index('IDX_lw_migrations_deployment', ['project', 'deployment', 'startedAt'])
export class MigrationEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id!: string;

  /** `project/deployment/service/index` */
  @Column({ type: 'varchar', length: 256, name: 'replica' })
  replica!: string;

  @Column({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @Column({ type: 'varchar', length: 63, name: 'deployment' })
  deployment!: string;

  @Column({ type: 'varchar', length: 63, name: 'from_node' })
  fromNode!: string;

  @Column({ type: 'varchar', length: 63, name: 'to_node' })
  toNode!: string;

  @Column({ type: 'varchar', length: 16, name: 'method' })
  method!: MigrationMethod;

  @Column({ type: 'integer', name: 'attempt' })
  attempt!: number;

  /**
   * `prepare` → `precopy` → `freeze` → `transfer` → `restore` → `cutover` → `done` for checkpoint attempts,
   * `aborting` → `fallback` on failure; `starting` / `stopping` → `done` | `failed` for blue / green and short stop;
   * `cancelled` when the migration was abandoned (target lost, plan changed).
   */
  @Column({ type: 'varchar', length: 16, name: 'phase' })
  phase!: string;

  /** Why the move happened: an applied plan or a drain. */
  @Column({ type: 'varchar', length: 16, name: 'reason' })
  reason!: 'plan' | 'drain';

  /** The method as chosen and explained in the plan (e.g. `short-stop (privileged container)`). */
  @Column({ type: 'varchar', length: 512, name: 'method_label' })
  methodLabel!: string;

  @Column({ type: 'varchar', length: 2048, name: 'fallback_reason', nullable: true })
  fallbackReason!: string | null;

  @Column({ type: 'integer', name: 'freeze_ms', nullable: true })
  freezeMs!: number | null;

  @Column({ type: 'bigint', name: 'checkpoint_bytes', nullable: true })
  checkpointBytes!: string | null;

  @Column({ type: 'integer', name: 'precopy_rounds', nullable: true })
  precopyRounds!: number | null;

  /** Checkpoint runtime (`runc` / `runsc`) of checkpoint attempts. */
  @Column({ type: 'varchar', length: 8, name: 'runtime', nullable: true })
  runtime!: 'runc' | 'runsc' | null;

  /** Addresses the replica keeps (checkpoint attempts). */
  @Column({ type: 'jsonb', name: 'addresses', default: () => "'[]'" })
  addresses!: string[];

  /** Volumes demoted on the source / promoted on the target. */
  @Column({ type: 'jsonb', name: 'volumes', default: () => "'[]'" })
  volumes!: string[];

  /** Internal: the spec the target prepares (what the source runs). Never returned by the API. */
  @Column({ type: 'jsonb', name: 'spec', nullable: true, select: false })
  spec!: Record<string, unknown> | null;

  /** Internal: single-use transfer token of the attempt. Never returned by the API. */
  @Column({ type: 'varchar', length: 64, name: 'token', nullable: true, select: false })
  token!: string | null;

  /** Latest report per node role and phase (`migrationProgress`). */
  @Column({ type: 'jsonb', name: 'reports', default: () => "'{}'" })
  reports!: SessionReports;

  /** The attempt reached `restore` (the target may run the replica). */
  @Column({ type: 'boolean', name: 'restore_sent', default: false })
  restoreSent!: boolean;

  @Column({ type: 'timestamptz', name: 'phase_started_at' })
  phaseStartedAt!: Date;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;
}
