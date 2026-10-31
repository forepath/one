import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type CronRunState = 'running' | 'succeeded' | 'failed' | 'timed-out' | 'cancelled' | 'skipped' | 'node-lost';

/** Per cron job: the last due time already handled, so every due time fires exactly once cluster-wide (3.23). */
@Entity('lw_cron_schedules')
export class CronScheduleEntity {
  /** `project/deployment/service` */
  @PrimaryColumn({ type: 'varchar', length: 192, name: 'id' })
  id!: string;

  @Column({ type: 'timestamptz', name: 'last_scheduled_at' })
  lastScheduledAt!: Date;

  /** Run counter; the run's workload is `project/deployment/service/<sequence>`. */
  @Column({ type: 'integer', name: 'sequence', default: 0 })
  sequence!: number;
}

/** One run of a cron job (3.23), kept as history with node, exit code and timing. */
@Entity('lw_cron_runs')
@Unique('UQ_lw_cron_runs_due', ['cron', 'scheduledAt', 'attempt'])
@Index('IDX_lw_cron_runs_cron', ['cron', 'createdAt'])
export class CronRunEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** `project/deployment/service` */
  @Column({ type: 'varchar', length: 192, name: 'cron' })
  cron!: string;

  @Column({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @Column({ type: 'timestamptz', name: 'scheduled_at' })
  scheduledAt!: Date;

  /** 0 for the first try, then one per retry. */
  @Column({ type: 'integer', name: 'attempt', default: 0 })
  attempt!: number;

  /** Workload id of the run's container; null for skipped runs. */
  @Column({ type: 'varchar', length: 256, name: 'workload', nullable: true })
  workload!: string | null;

  @Column({ type: 'varchar', length: 63, name: 'node', nullable: true })
  node!: string | null;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: CronRunState;

  @Column({ type: 'integer', name: 'exit_code', nullable: true })
  exitCode!: number | null;

  @Column({ type: 'varchar', length: 500, name: 'message', nullable: true })
  message!: string | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  /** `clock_timestamp()`: runs created in one transaction still sort in creation order. */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
