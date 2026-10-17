import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PlanStatus = 'pending' | 'applying' | 'applied' | 'failed' | 'discarded';

export interface PlanResourceChange {
  action: 'create' | 'update' | 'delete' | 'unchanged';
  kind: string;
  name: string;
  project: string | null;
  /** Generation the change was planned against (0 = did not exist); apply refuses if it moved. */
  baseGeneration: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * A plan: the diff between submitted and current desired state, plus its compiled effect per layer (3.8).
 */
@Entity('lw_plans')
@Index('IDX_lw_plans_created_at', ['createdAt'])
export class PlanEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 16, name: 'status', default: 'pending' })
  status!: PlanStatus;

  @Column({ type: 'jsonb', name: 'changes' })
  changes!: PlanResourceChange[];

  /** Per-layer network effects ("adds WireGuard peer n1↔n3"). */
  @Column({ type: 'jsonb', name: 'network_changes', default: () => "'[]'" })
  networkChanges!: Record<string, unknown>[];

  @Column({ type: 'jsonb', name: 'diagnostics', default: () => "'[]'" })
  diagnostics!: Record<string, unknown>[];

  /** Replica starts, stops and moves with the chosen method (3.10). */
  @Column({ type: 'jsonb', name: 'workload_changes', default: () => "'[]'" })
  workloadChanges!: Record<string, unknown>[];

  /** Single points of failure per node / site loss (3.12). */
  @Column({ type: 'jsonb', name: 'failure_analysis', nullable: true })
  failureAnalysis!: Record<string, unknown> | null;

  /** Pinned images and secret versions per deployment this plan applies (3.22). */
  @Column({ type: 'jsonb', name: 'deployment_states', default: () => "'{}'" })
  deploymentStates!: Record<string, { images: Record<string, string>; secretVersions: Record<string, number> }>;

  /** Compose warnings, unacknowledged pins and services on project defaults. */
  @Column({ type: 'jsonb', name: 'warnings', default: () => "'[]'" })
  warnings!: Record<string, unknown>[];

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'applied_at', nullable: true })
  appliedAt!: Date | null;
}
