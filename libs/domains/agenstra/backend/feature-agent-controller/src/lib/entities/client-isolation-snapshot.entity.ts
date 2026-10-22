import type { HostIsolationCapabilitiesDto } from '@forepath/agenstra/backend/feature-agent-manager';
import { ClientEntity } from '@forepath/identity/backend';
import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Last observed container isolation capabilities of a workspace host (agent manager).
 * Used to detect capability transitions (notifications) and as a stale fallback while the
 * agent manager is unreachable.
 */
@Entity('client_isolation_snapshots')
export class ClientIsolationSnapshotEntity {
  @PrimaryColumn({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @OneToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  /** Capability revision reported by the agent manager (`null` until capabilities were observed). */
  @Column({ type: 'varchar', length: 80, nullable: true, name: 'revision' })
  revision?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'standard_state' })
  standardState?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'sandboxed_state' })
  sandboxedState?: string | null;

  /** State of the sandboxed-kvm level (`null` for snapshots recorded before the level existed). */
  @Column({ type: 'varchar', length: 32, nullable: true, name: 'sandboxed_kvm_state' })
  sandboxedKvmState?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'recommended_level' })
  recommendedLevel?: string | null;

  /** Full capability record as reported by the agent manager. */
  @Column({ type: 'jsonb', nullable: true, name: 'capabilities' })
  capabilities?: HostIsolationCapabilitiesDto | null;

  @Column({ type: 'timestamp', nullable: true, name: 'probed_at' })
  probedAt?: Date | null;

  /** Last background check (also for legacy / unreachable agent managers). */
  @Column({ type: 'timestamp', nullable: true, name: 'checked_at' })
  checkedAt?: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
