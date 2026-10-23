import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { MigrationMethod, SessionRuntime } from '../utils/migration-eligibility.utils';
import type { SessionPhase } from '../utils/migration-state.utils';

/** A replica moving between nodes (3.10). */
export interface PlacementMigration {
  method: MigrationMethod;
  /**
   * `queued` (waiting for its dependency wave), `starting` (blue / green), `stopping` (short stop) or the phase of a
   * checkpoint attempt (`prepare` … `restore`, `aborting`).
   */
  phase: 'queued' | 'starting' | 'stopping' | SessionPhase;
  reason: 'plan' | 'drain';
  startedAt: string;
  /** History row of the current attempt (`lw_migrations`). */
  id?: string;
  attempt?: number;
  /** The method as the plan explains it, e.g. `short-stop (privileged container)`. */
  label?: string;
  /** Dependency wave (3.10): replicas that must have moved and run before this one starts. */
  after?: string[];
  /** Session runtime of `live` / `stop-and-copy` (runc / runsc) and `vm-live` (qemu). */
  runtime?: SessionRuntime;
}

/** Where one replica runs and with which addresses (3.11). Written on apply; status reported by the agent. */
@Entity('lw_workload_placements')
@Index('IDX_lw_workload_placements_node', ['node'])
export class WorkloadPlacementEntity {
  /** `project/deployment/service/<index>` */
  @PrimaryColumn({ type: 'varchar', length: 256, name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @Column({ type: 'varchar', length: 63, name: 'deployment' })
  deployment!: string;

  @Column({ type: 'varchar', length: 63, name: 'service' })
  service!: string;

  @Column({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  /** Container addresses inside the node's pod subnets (IPv4 and / or IPv6). */
  @Column({ type: 'jsonb', name: 'addresses', default: () => "'[]'" })
  addresses!: string[];

  /** Migration target (3.10): blue / green runs both, short stop stops here first. */
  @Column({ type: 'varchar', length: 63, name: 'target_node', nullable: true })
  targetNode!: string | null;

  @Column({ type: 'jsonb', name: 'target_addresses', default: () => "'[]'" })
  targetAddresses!: string[];

  @Column({ type: 'jsonb', name: 'migration', nullable: true })
  migration!: PlacementMigration | null;

  /**
   * Restored from a checkpoint on its node (3.10): runs as an agent-managed runc / runsc container until its next
   * restart. Cleared when the replica moves again.
   */
  @Column({ type: 'jsonb', name: 'restored', nullable: true })
  restored!: { migration: string; runtime: 'runc' | 'runsc' } | null;

  /**
   * Ordering gate of one-off jobs (3.23): `before-jobs` keeps a service on its released spec until the deployment's
   * `before` jobs succeeded; `after-services` holds an `after` job until the services run.
   */
  @Column({ type: 'varchar', length: 16, name: 'gate', nullable: true })
  gate!: 'before-jobs' | 'after-services' | null;

  /** Last spec released to the node; served while a `before-jobs` gate holds back the new one. */
  @Column({ type: 'jsonb', name: 'released_spec', nullable: true })
  releasedSpec!: Record<string, unknown> | null;

  /** Set for the container of a cron run (3.23); such placements are owned by the cron controller, not by plans. */
  @Column({ type: 'uuid', name: 'cron_run', nullable: true })
  cronRun!: string | null;

  /**
   * Removed by a plan or a scale-down and draining (M6 gate): out of routing (service IPs, mesh, ingress) but still
   * running its last released spec until then; the drain controller deletes the placement afterwards, which stops it.
   */
  @Column({ type: 'timestamptz', name: 'drain_until', nullable: true })
  drainUntil!: Date | null;

  @Column({ type: 'varchar', length: 64, name: 'spec_hash', nullable: true })
  specHash!: string | null;

  /** Last state reported per node (a migrating replica runs on two nodes). `absent` = no container there. */
  @Column({ type: 'jsonb', name: 'status', nullable: true })
  status!: Record<
    string,
    {
      state: string;
      exitCode?: number;
      message?: string;
      /** Full VMs (3.35): guest power state (`VM_POWER_STATES`) and a boot disk being written from its image. */
      vm?: {
        power?: string;
        importing?: boolean;
        /** The boot disk import's progress (background job on the node, F3b). */
        importProgress?: { phase: string; bytes?: number; totalBytes?: number };
      };
      specHash: string;
      at: string;
    }
  > | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
