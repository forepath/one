import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Append-only, hash-chained audit log (3.18). Written in the same transaction as the change it records;
 * every entry stores the hash of the previous one, so tampering breaks the chain.
 */
@Entity('lw_audit_events')
@Index('IDX_lw_audit_events_at', ['at'])
@Index('IDX_lw_audit_events_project', ['project', 'at'])
export class AuditEventEntity {
  /** Gapless sequence assigned under the chain lock. */
  @PrimaryColumn({ type: 'bigint', name: 'seq' })
  seq!: string;

  @Column({ type: 'timestamptz', name: 'at' })
  at!: Date;

  @Column({ type: 'varchar', length: 16, name: 'actor_type' })
  actorType!: 'user' | 'api-key' | 'node' | 'system';

  @Column({ type: 'varchar', length: 255, name: 'actor_id', nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar', length: 128, name: 'action' })
  action!: string;

  @Column({ type: 'varchar', length: 512, name: 'target' })
  target!: string;

  @Column({ type: 'varchar', length: 63, name: 'project', nullable: true })
  project!: string | null;

  /** Never contains secret values, only versions / hashes (3.22). */
  @Column({ type: 'jsonb', name: 'details', default: () => "'{}'" })
  details!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, name: 'prev_hash' })
  prevHash!: string;

  @Column({ type: 'varchar', length: 64, name: 'hash' })
  hash!: string;
}
