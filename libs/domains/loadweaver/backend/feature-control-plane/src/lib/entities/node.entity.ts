import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type NodeLifecycle = 'active' | 'cordoned' | 'draining' | 'leaving' | 'left';

/**
 * Inventory of a joined node (3.21). The declarative part (site, labels, schedulability) mirrors the `Node`
 * resource; everything else is reported by the agent or allocated by the control plane.
 */
@Entity('lw_nodes')
export class NodeEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 63, name: 'name', unique: true })
  name!: string;

  @Column({ type: 'varchar', length: 63, name: 'site' })
  site!: string;

  @Column({ type: 'varchar', length: 16, name: 'lifecycle', default: 'active' })
  lifecycle!: NodeLifecycle;

  @Column({ type: 'jsonb', name: 'labels', default: () => "'{}'" })
  labels!: Record<string, string>;

  @Column({ type: 'boolean', name: 'control_plane', default: false })
  controlPlane!: boolean;

  @Column({ type: 'boolean', name: 'witness', default: false })
  witness!: boolean;

  @Column({ type: 'varchar', length: 64, name: 'agent_version', nullable: true })
  agentVersion!: string | null;

  @Column({ type: 'jsonb', name: 'os', nullable: true })
  os!: { id: string; versionId: string; kernel: string; arch: string } | null;

  @Column({ type: 'jsonb', name: 'capabilities', nullable: true })
  capabilities!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', name: 'capacity', nullable: true })
  capacity!: { cpuMillis: number; memoryBytes: number; diskBytes: number } | null;

  @Column({ type: 'jsonb', name: 'usage', nullable: true })
  usage!: { cpuMillis: number; memoryBytes: number; diskBytes: number } | null;

  @Column({ type: 'varchar', length: 64, name: 'wireguard_public_key' })
  wireguardPublicKey!: string;

  /** X25519 key the node's master-key share is sealed to (3.22). */
  @Column({ type: 'varchar', length: 64, name: 'seal_public_key', nullable: true })
  sealPublicKey!: string | null;

  @Column({ type: 'varchar', length: 253, name: 'endpoint_host', nullable: true })
  endpointHost!: string | null;

  @Column({ type: 'varchar', length: 45, name: 'overlay_v4', nullable: true })
  overlayV4!: string | null;

  @Column({ type: 'varchar', length: 45, name: 'overlay_v6', nullable: true })
  overlayV6!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'pod_subnet_v4', nullable: true })
  podSubnetV4!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'pod_subnet_v6', nullable: true })
  podSubnetV6!: string | null;

  /** SHA-256 fingerprints of certificates the node may present (current + the one being rotated out). */
  @Column({ type: 'jsonb', name: 'certificate_fingerprints', default: () => "'[]'" })
  certificateFingerprints!: string[];

  @Column({ type: 'timestamptz', name: 'certificate_not_after', nullable: true })
  certificateNotAfter!: Date | null;

  @Column({ type: 'integer', name: 'applied_revision', default: 0 })
  appliedRevision!: number;

  @Column({ type: 'varchar', length: 16, name: 'apply_status', nullable: true })
  applyStatus!: 'applied' | 'failed' | 'rolled-back' | null;

  @Column({ type: 'text', name: 'apply_error', nullable: true })
  applyError!: string | null;

  /** Operator confirmed the node is gone: stateful workloads may fail over without quorum (2 nodes, no witness, 3.2). */
  @Column({ type: 'timestamptz', name: 'lost_confirmed_at', nullable: true })
  lostConfirmedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_seen_at', nullable: true })
  lastSeenAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'joined_at' })
  joinedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
