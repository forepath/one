import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

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
  migration!: {
    method: 'blue-green' | 'short-stop';
    phase: 'starting' | 'stopping';
    reason: 'plan' | 'drain';
    startedAt: string;
  } | null;

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

  @Column({ type: 'varchar', length: 64, name: 'spec_hash', nullable: true })
  specHash!: string | null;

  /** Last state reported per node (a migrating replica runs on two nodes). `absent` = no container there. */
  @Column({ type: 'jsonb', name: 'status', nullable: true })
  status!: Record<string, { state: string; exitCode?: number; message?: string; specHash: string; at: string }> | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
