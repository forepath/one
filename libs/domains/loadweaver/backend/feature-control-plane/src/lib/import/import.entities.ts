import type { DiscoveryReport } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { ImportSelections, JoinPlan } from '@forepath/loadweaver/shared/util-import';
import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** The latest read-only discovery of a node that joined for an import (3.21). */
@Entity('lw_node_discoveries')
export class NodeDiscoveryEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  /** Changes with every report: a join plan built from an older one is stale. */
  @Column({ type: 'uuid', name: 'id' })
  id!: string;

  /** Redacted on the node (compose secrets, sensitive `.env` values, labels); re-checked before it is stored. */
  @Column({ type: 'jsonb', name: 'report' })
  report!: DiscoveryReport;

  @Column({ type: 'varchar', length: 16, name: 'source' })
  source!: 'join' | 'refresh';

  /** An outstanding `discoveryRequest`. */
  @Column({ type: 'uuid', name: 'request_id', nullable: true })
  requestId!: string | null;

  @Column({ type: 'timestamptz', name: 'requested_at', nullable: true })
  requestedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'received_at' })
  receivedAt!: Date;
}

export type ImportStatus = 'draft' | 'planned' | 'running' | 'done' | 'failed' | 'rolled-back' | 'discarded';

export interface ImportStepState {
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  message?: string;
  bytes?: number;
  startedAt?: string;
  finishedAt?: string;
  /** Last time the command was sent to the node (re-sent until it reports). */
  sentAt?: string;
}

/** The import wizard's selections for a pending node, their join plan and its progress (3.21). */
@Entity('lw_import_selections')
export class ImportSelectionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  @Column({ type: 'uuid', name: 'discovery_id' })
  discoveryId!: string;

  @Column({ type: 'jsonb', name: 'selections' })
  selections!: ImportSelections;

  @Column({ type: 'jsonb', name: 'join_plan' })
  joinPlan!: JoinPlan;

  @Column({ type: 'varchar', length: 20, name: 'status', default: 'draft' })
  status!: ImportStatus;

  /** The plan (deployments + `NodeImport`) this selection was turned into. */
  @Column({ type: 'uuid', name: 'plan_id', nullable: true })
  planId!: string | null;

  @Column({ type: 'jsonb', name: 'steps', default: () => "'{}'" })
  steps!: Record<string, ImportStepState>;

  /** Restart policies of the stopped source containers (for a rollback). */
  @Column({ type: 'jsonb', name: 'restart_policies', default: () => "'{}'" })
  restartPolicies!: Record<string, string>;

  /** Imported deployments (`project/name`) released to run under Loadweaver. */
  @Column({ type: 'jsonb', name: 'released', default: () => "'[]'" })
  released!: string[];

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
