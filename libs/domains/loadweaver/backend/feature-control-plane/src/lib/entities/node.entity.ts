import type { ComponentVersions } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { StepTarget } from '../updates/rollout.entity';

/**
 * `pending`: joined for an import (3.21) — identity and stream, but no desired state, nothing changes on the host;
 * `importing`: its join plan is applied — schedulable for the planner (its imported deployments are placed), still no
 * desired state until the import controller activates it after installing the components.
 */
export type NodeLifecycle = 'pending' | 'importing' | 'active' | 'cordoned' | 'draining' | 'leaving' | 'left';

/** Lifecycles of a node that joined for an import and isn't activated yet: no desired state, no network peer. */
export const IMPORT_LIFECYCLES: readonly NodeLifecycle[] = ['pending', 'importing'];

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

  /** Agent-protocol version negotiated at the last hello (3.26); 0 = before versioning. */
  @Column({ type: 'integer', name: 'protocol_version', default: 0 })
  protocolVersion!: number;

  /** Optional protocol features both sides know (e.g. `live-migration`), from the last hello. */
  @Column({ type: 'jsonb', name: 'protocol_features', default: () => "'[]'" })
  protocolFeatures!: string[];

  /** What the node runs (3.26): release, platform images, kernel, packages, update progress (hello / heartbeat). */
  @Column({ type: 'jsonb', name: 'component_versions', nullable: true })
  componentVersions!: ComponentVersions | null;

  /** The release (and host update / actions) the update rollout set for this node; null before its first rollout. */
  @Column({ type: 'jsonb', name: 'component_target', nullable: true })
  componentTarget!: StepTarget | null;

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

  /** The host's kernel node name (`uname -n`) from the agent's hello; DRBD's `on` sections use it (3.5). */
  @Column({ type: 'varchar', length: 64, name: 'hostname', nullable: true })
  hostname!: string | null;

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

  /** An agent stream is open (set on hello, cleared on disconnect); with a fresh heartbeat, the node reports applies. */
  @Column({ type: 'boolean', name: 'connected', default: false })
  connected!: boolean;

  /** Revision and per-layer steps of the node's last apply report (3.19 progress). */
  @Column({ type: 'integer', name: 'last_report_revision', nullable: true })
  lastReportRevision!: number | null;

  @Column({ type: 'jsonb', name: 'last_report_steps', nullable: true })
  lastReportSteps!: { layer: string; status: string; message?: string }[] | null;

  /** Host ports found by the import discovery (3.21): generated WireGuard listen ports skip them. */
  @Column({ type: 'jsonb', name: 'reserved_ports', nullable: true })
  reservedPorts!: { tcp: number[]; udp: number[] } | null;

  /** Things on the node Loadweaver doesn't own (3.8): reported as drift, never touched. */
  @Column({ type: 'jsonb', name: 'drift', nullable: true })
  drift!: {
    containers: {
      id: string;
      name: string;
      image: string;
      state: string;
      ports: string[];
      /** Started by this replica through its Docker socket (delegated, not drift). */
      delegatedTo?: string;
    }[];
    at: string;
  } | null;

  @Column({ type: 'timestamptz', name: 'last_seen_at', nullable: true })
  lastSeenAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'joined_at' })
  joinedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
