import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * An update (3.26) is a plan: `planned` with its per-node / per-component diff, approved (policy or person), then
 * run step by step by the rollout controller. A failing step pauses the rollout and rolls that step back; a failed
 * rollback shows the real state (`rollback-failed`) and needs a fix-forward (a new update plan).
 */
export type RolloutStatus =
  | 'planned'
  | 'approved'
  | 'running'
  | 'paused'
  | 'rolling-back'
  | 'rolled-back'
  | 'rollback-failed'
  | 'completed'
  | 'cancelled'
  | 'superseded';

export const ACTIVE_ROLLOUT_STATUSES: readonly RolloutStatus[] = ['approved', 'running', 'paused', 'rolling-back'];

export interface RolloutOptions {
  /** Respect maintenance windows (default); `ignore` only for emergency fixes with an explicit approval. */
  windows: 'respect' | 'ignore';
  /** Include host updates (OS packages, kernel, gVisor, DRBD module) with drain → reboot where needed. */
  host: boolean;
  /** Upgrade every OS package to the snapshot (security updates), not only the bundle's pins. */
  osUpgrade: boolean;
  /** The frozen apt snapshot host steps install from (taken at plan time). */
  snapshot?: string;
  /** Online cluster: DRBD may fall back to LINBIT's SPAAS for kernels the release doesn't cover (`drbdSpaasAllowed`). */
  drbdSpaas?: boolean;
  /** Created by the update policy (auto-patch) rather than a person. */
  automatic: boolean;
  emergency: boolean;
}

/** One line of the plan's diff: a node's component from → to. */
export interface RolloutDiffEntry {
  node: string;
  component: string;
  from: string | null;
  to: string | null;
  /** How it updates (3.26 table): binary swap, hot restart, member by member, drain → reboot, … */
  method: string;
}

@Entity('lw_rollouts')
@Index('IDX_lw_rollouts_created_at', ['createdAt'])
export class RolloutEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 20, name: 'status', default: 'planned' })
  status!: RolloutStatus;

  /** The release before (what most nodes ran when planned) and the target. */
  @Column({ type: 'varchar', length: 64, name: 'from_version', nullable: true })
  fromVersion!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'to_version' })
  toVersion!: string;

  /** `patch` / `minor` / `major` / `os` (host updates of the same release). */
  @Column({ type: 'varchar', length: 8, name: 'kind' })
  kind!: 'patch' | 'minor' | 'major' | 'os' | 'downgrade';

  @Column({ type: 'jsonb', name: 'options' })
  options!: RolloutOptions;

  @Column({ type: 'jsonb', name: 'diff', default: () => "'[]'" })
  diff!: RolloutDiffEntry[];

  /** Compatibility notes from the manifest and the planner. */
  @Column({ type: 'jsonb', name: 'notes', default: () => "'[]'" })
  notes!: string[];

  @Column({ type: 'jsonb', name: 'warnings', default: () => "'[]'" })
  warnings!: string[];

  /** Per wave: what is unavailable or at risk while it runs (3.12). */
  @Column({ type: 'jsonb', name: 'failure_analysis', default: () => "'[]'" })
  failureAnalysis!: { wave: number; nodes: string[]; risk: string[] }[];

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'approved_by', nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'approved_at', nullable: true })
  approvedAt!: Date | null;

  /** Why the controller paused (failed gate, window closed, operator). */
  @Column({ type: 'text', name: 'pause_reason', nullable: true })
  pauseReason!: string | null;

  @Column({ type: 'boolean', name: 'pause_requested', default: false })
  pauseRequested!: boolean;

  /** Leader lease of the controller replica driving the rollout (taken over when it expires). */
  @Column({ type: 'varchar', length: 64, name: 'lease_owner', nullable: true })
  leaseOwner!: string | null;

  @Column({ type: 'timestamptz', name: 'lease_until', nullable: true })
  leaseUntil!: Date | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type RolloutStepState =
  | 'pending'
  | 'waiting-window'
  | 'draining'
  | 'switchover'
  | 'applying'
  | 'rebooting'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'rolling-back'
  | 'rolled-back'
  | 'rollback-failed'
  | 'skipped';

/** The node's components before the step (restored by its rollback). */
export interface StepTarget {
  release: string | null;
  /** `spaas`: online cluster, DRBD may build with LINBIT's SPAAS for uncovered kernels (`drbdSpaasAllowed`). */
  host?: { id: string; snapshot: string; upgrade: boolean; reboot?: string; spaas?: boolean };
  actions?: { patroniSwitchover?: { id: string; candidate: string } };
}

/** What the controller remembers between ticks (resumable after a leader change). */
export interface StepData {
  /** Health before the step: failed / at-risk entity keys and burning SLOs. */
  baseline?: { unhealthy: string[]; burning: string[] };
  bootId?: string;
  switchoverId?: string;
  rebootToken?: string;
  /** The node was drained by this step (uncordoned again at its end). */
  drained?: boolean;
  /** The host update was handed to the node (packages may have changed from here on). */
  hostApplied?: boolean;
  /** The node used KVM when the host step started (3.1): the KVM gate checks it is still usable after the reboot. */
  kvmBefore?: boolean;
  previousLifecycle?: string;
  settledSince?: string;
  /** Last gate evaluation, for the console. */
  gates?: { name: string; ok: boolean; message: string }[];
}

@Entity('lw_rollout_steps')
@Index('IDX_lw_rollout_steps_rollout', ['rolloutId', 'index'], { unique: true })
export class RolloutStepEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'rollout_id' })
  rolloutId!: string;

  @Column({ type: 'integer', name: 'index' })
  index!: number;

  /** 0 = control-plane members, 1 = canary, 2… = waves. */
  @Column({ type: 'integer', name: 'wave' })
  wave!: number;

  @Column({ type: 'varchar', length: 16, name: 'phase' })
  phase!: 'control-plane' | 'canary' | 'wave';

  @Column({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  @Column({ type: 'varchar', length: 63, name: 'site' })
  site!: string;

  /** `components`: images + agent (no drain); `host`: drain → packages / kernel / gVisor / DRBD → reboot → rejoin. */
  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: 'components' | 'host';

  @Column({ type: 'varchar', length: 20, name: 'state', default: 'pending' })
  state!: RolloutStepState;

  @Column({ type: 'jsonb', name: 'before', nullable: true })
  before!: StepTarget | null;

  @Column({ type: 'jsonb', name: 'target' })
  target!: StepTarget;

  @Column({ type: 'jsonb', name: 'data', default: () => "'{}'" })
  data!: StepData;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamptz', name: 'state_changed_at', nullable: true })
  stateChangedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;
}
