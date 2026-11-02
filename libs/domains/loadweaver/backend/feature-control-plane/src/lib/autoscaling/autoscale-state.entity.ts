import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { AutoscaleWindowEntry } from './autoscale.utils';

/** What the autoscaler saw and decided last for a service (3.23), for the API and the console. */
export interface AutoscaleStatus {
  metric: string;
  target: number;
  min: number;
  max: number;
  /** The metric's value at the last evaluation; null when it was missing. */
  value: number | null;
  /** What the last evaluation recommended within min..max (before stabilisation, cooldowns and limits). */
  desired: number;
  action: 'up' | 'down' | 'hold';
  /** Why the last evaluation held / what it did. */
  reason: string;
  /** Why a wanted scale-up was limited (quota, cluster capacity, N+1 reserve) or refused; null when not blocked. */
  blocked: string | null;
  /** More replicas were wanted than `max` allows. */
  atMax: boolean;
  evaluatedAt: string;
}

/**
 * The autoscaler's state per autoscaled service (3.23): the replica count the planner uses instead of the compose
 * `replicas`, the last scaling action and the window of recommendations for the scale-down stabilisation.
 */
@Entity('lw_autoscale_state')
@Index('IDX_lw_autoscale_state_project', ['project'])
export class AutoscaleStateEntity {
  /** `project/deployment/service` */
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'service_key' })
  serviceKey!: string;

  @Column({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @Column({ type: 'integer', name: 'replicas' })
  replicas!: number;

  @Column({ type: 'timestamptz', name: 'last_scale_at', nullable: true })
  lastScaleAt!: Date | null;

  /** `2 → 4: cpu 140 % / target 70 %` */
  @Column({ type: 'text', name: 'last_reason', nullable: true })
  lastReason!: string | null;

  /** The metric value of the last scaling action. */
  @Column({ type: 'double precision', name: 'last_value', nullable: true })
  lastValue!: number | null;

  @Column({ type: 'jsonb', name: 'recommendations', default: () => "'[]'" })
  recommendations!: AutoscaleWindowEntry[];

  @Column({ type: 'jsonb', name: 'status', nullable: true })
  status!: AutoscaleStatus | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
