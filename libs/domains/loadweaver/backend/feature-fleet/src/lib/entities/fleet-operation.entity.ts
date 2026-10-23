import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const FLEET_OPERATION_KINDS = ['cross-cluster-restore', 'clone', 'final-backup'] as const;
export type FleetOperationKind = (typeof FLEET_OPERATION_KINDS)[number];

export const FLEET_OPERATION_STATUSES = ['running', 'waiting', 'succeeded', 'failed', 'cancelled'] as const;
export type FleetOperationStatus = (typeof FLEET_OPERATION_STATUSES)[number];

export type FleetStepStatus = 'pending' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'skipped';

export interface FleetOperationStep {
  key: string;
  status: FleetStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  /** Non-secret result of the step (ids, counts, links). */
  detail: Record<string, unknown>;
  error: string | null;
  attempts: number;
}

/** A multi-step fleet operation across clusters (3.20 cross-cluster restore / clone, section 4 final backup). */
@Entity('lw_fleet_operations')
@Index('IDX_lw_fleet_operations_status', ['status', 'updatedAt'])
export class FleetOperationEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 32, name: 'kind' })
  kind!: FleetOperationKind;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: FleetOperationStatus;

  @Column({ type: 'uuid', name: 'source_cluster_id', nullable: true })
  sourceClusterId!: string | null;

  @Column({ type: 'uuid', name: 'target_cluster_id' })
  targetClusterId!: string;

  /** Validated input (backup id, target volume, apply, ...). */
  @Column({ type: 'jsonb', name: 'params', default: () => "'{}'" })
  params!: Record<string, unknown>;

  @Column({ type: 'jsonb', name: 'steps', default: () => "'[]'" })
  steps!: FleetOperationStep[];

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  /** Fleet label of the acting user, forwarded as on-behalf-of to the clusters. */
  @Column({ type: 'varchar', length: 255, name: 'on_behalf_of', nullable: true })
  onBehalfOf!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
