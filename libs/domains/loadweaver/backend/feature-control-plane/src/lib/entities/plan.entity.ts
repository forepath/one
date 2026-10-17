import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * `applying` until every connected node reported the revision (3.19); a failure or cancel rolls back
 * (`rolling-back` → `rolled-back`), and a failed rollback stays `rollback-failed` with its locks until a fix-forward
 * plan resolves it.
 */
export type PlanStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'discarded'
  | 'rolling-back'
  | 'rolled-back'
  | 'rollback-failed';

export type NodeApplyState = 'pending' | 'applied' | 'failed' | 'skipped';

/** Live progress of an apply or rollback (Agenstra's step + % pattern). */
export interface PlanProgress {
  phase: 'apply' | 'rollback';
  /** Cluster revision before this phase: nodes whose desired state moved past it have to report. */
  baseRevision: number;
  /** Per node: the desired-state revision it has to reach; null until compiled. */
  targets: Record<string, number> | null;
  step: string;
  percent: number;
  startedAt: string;
  nodes: Record<string, { state: NodeApplyState; steps?: { layer: string; status: string }[]; error?: string }>;
  /** Why this phase failed (first failing node / cancel / timeout). */
  failure?: string;
  /** Rollback phase: why the apply was rolled back. */
  cause?: string;
}

/** What a rollback restores besides the resources' previous specs. */
export interface PlanRollback {
  deploymentStates: Record<string, { images: Record<string, string>; secretVersions: Record<string, number> } | null>;
}

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

/** A pull request Loadweaver opened for a plan of an authoritative scope (3.29), or the reason it couldn't. */
export interface PlanPullRequest {
  connection: string;
  branch: string;
  url?: string;
  number?: number;
  error?: string;
  /** The pull request is being opened (asynchronously after the plan was created); url / error follow. */
  pending?: boolean;
}

/**
 * Where a plan came from (3.29): a Git commit (connection, commit, ref, PR, author), the UI, the API, the drift view,
 * or the system (fix-forward plans of failed rollbacks).
 */
export interface PlanSource {
  kind: 'git' | 'ui' | 'api' | 'drift' | 'system';
  connection?: string;
  commit?: string;
  ref?: string;
  pr?: number;
  /** Pull / merge request URL (plan bot, 3.30). */
  prUrl?: string;
  author?: string;
  /** Authoritative scopes: the pull requests this plan was turned into; it is applied through them. */
  pullRequests?: PlanPullRequest[];
  /** The UI / API plan of an authoritative scope that this pull request plan replaces (3.29). */
  supersedes?: string;
  /** Set on a UI / API plan that a pull request plan replaced (it is discarded). */
  supersededBy?: string;
  /**
   * Loadweaver users behind the Git change (the pull request's author, the pusher of a default-branch commit, mapped
   * through linked accounts): they can't approve it (3.17 / 3.30). Unknown authors aren't listed.
   */
  authors?: string[];
  /** Plan bot: planned only for this project or path (`loadweaver plan <x>`); applying it doesn't merge. */
  limited?: string;
}

/**
 * A plan: the diff between submitted and current desired state, plus its compiled effect per layer (3.8).
 */
@Entity('lw_plans')
@Index('IDX_lw_plans_created_at', ['createdAt'])
export class PlanEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 20, name: 'status', default: 'pending' })
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

  /** The creator's role in each touched project when the plan was made (approvals depend on it, 3.17). */
  @Column({ type: 'jsonb', name: 'creator_roles', default: () => "'{}'" })
  creatorRoles!: Record<string, string>;

  /** Per project: why its part is risky (unacknowledged pins, internet exposure) for the `risky` approval mode. */
  @Column({ type: 'jsonb', name: 'risk', default: () => "'{}'" })
  risk!: Record<string, string[]>;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'jsonb', name: 'progress', nullable: true })
  progress!: PlanProgress | null;

  @Column({ type: 'boolean', name: 'cancel_requested', default: false })
  cancelRequested!: boolean;

  /** A fix-forward plan names the failed plan it resolves; it may take over that plan's locks. */
  @Column({ type: 'uuid', name: 'resolves', nullable: true })
  resolves!: string | null;

  @Column({ type: 'jsonb', name: 'source', nullable: true })
  source!: PlanSource | null;

  @Column({ type: 'jsonb', name: 'rollback', nullable: true })
  rollback!: PlanRollback | null;

  /** The replica tracking the apply refreshes this; a stale one is taken over by another replica. */
  @Column({ type: 'timestamptz', name: 'tracker_heartbeat_at', nullable: true })
  trackerHeartbeatAt!: Date | null;

  /** Replica instance tracking the apply. */
  @Column({ type: 'varchar', length: 64, name: 'tracker_owner', nullable: true })
  trackerOwner!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'applied_at', nullable: true })
  appliedAt!: Date | null;
}
