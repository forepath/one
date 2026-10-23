import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** What happened at the fleet (connections, grants, relayed changes, operations, Cloud hooks). */
@Entity('lw_fleet_audit_events')
@Index('IDX_lw_fleet_audit_events_at', ['at'])
@Index('IDX_lw_fleet_audit_events_cluster', ['clusterId', 'at'])
export class FleetAuditEventEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'seq' })
  seq!: string;

  @Column({ type: 'timestamptz', name: 'at', default: () => 'now()' })
  at!: Date;

  @Column({ type: 'varchar', length: 16, name: 'actor_type' })
  actorType!: 'user' | 'api-key' | 'system';

  @Column({ type: 'varchar', length: 255, name: 'actor_id', nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar', length: 128, name: 'action' })
  action!: string;

  @Column({ type: 'uuid', name: 'cluster_id', nullable: true })
  clusterId!: string | null;

  @Column({ type: 'varchar', length: 512, name: 'target' })
  target!: string;

  /** Never contains credentials. */
  @Column({ type: 'jsonb', name: 'details', default: () => "'{}'" })
  details!: Record<string, unknown>;
}
