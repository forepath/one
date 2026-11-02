import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Placement of a replicated volume (3.5): primary, synchronous replicas in its site, remote replicas. */
@Entity('lw_volume_placements')
export class VolumePlacementEntity {
  /** `project/deployment/volume` */
  @PrimaryColumn({ type: 'varchar', length: 200, name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 63, name: 'primary_node' })
  primaryNode!: string;

  /** New primary waiting for a short-stop migration to stop the workload on the current one (3.10). */
  @Column({ type: 'varchar', length: 63, name: 'pending_primary', nullable: true })
  pendingPrimary!: string | null;

  @Column({ type: 'jsonb', name: 'sync_replicas', default: () => "'[]'" })
  syncReplicas!: string[];

  @Column({ type: 'jsonb', name: 'remote_replicas', default: () => "'[]'" })
  remoteReplicas!: string[];

  @Column({ type: 'bigint', name: 'size_bytes' })
  sizeBytes!: string;

  @Column({ type: 'varchar', length: 8, name: 'cross_site' })
  crossSite!: 'async' | 'sync' | 'none';

  /** DRBD minor number and TCP port, unique per cluster (assigned once). */
  @Column({ type: 'integer', name: 'drbd_minor', unique: true })
  drbdMinor!: number;

  @Column({ type: 'integer', name: 'drbd_port' })
  drbdPort!: number;

  /**
   * DRBD node id per replica holder, stable for as long as the node holds a copy (DRBD keeps a node's id in its
   * metadata; failovers and migrations reorder the holders but must not renumber them).
   */
  @Column({ type: 'jsonb', name: 'drbd_node_ids', default: () => "'{}'" })
  drbdNodeIds!: Record<string, number>;

  /** Next DRBD node id to hand out (round robin over 0–31), so a removed peer's id isn't reused right away. */
  @Column({ type: 'integer', name: 'drbd_next_node_id', default: 0 })
  drbdNextNodeId!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
