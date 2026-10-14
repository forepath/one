import { ClientEntity } from '@forepath/identity/backend';
import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Per-workspace cursor into the agent manager's egress event feed (`GET /api/egress/events?afterSeq=`).
 */
@Entity('egress_event_ingest_cursors')
export class EgressEventIngestCursorEntity {
  @PrimaryColumn({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @OneToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  /** Last ingested manager `seq` (stringified bigint). */
  @Column({ type: 'bigint', name: 'last_seq', default: 0 })
  lastSeq!: string;

  @Column({ type: 'text', nullable: true, name: 'last_error' })
  lastError?: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'last_ingested_at' })
  lastIngestedAt?: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
