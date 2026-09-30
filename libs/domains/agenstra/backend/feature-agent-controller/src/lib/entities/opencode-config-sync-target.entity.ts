import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type OpencodeConfigSyncStatus = 'pending' | 'synced' | 'failed';

/**
 * Per-agent desired vs applied OpenCode effective config revision (filter-rules pattern).
 */
@Entity('opencode_config_sync_targets')
@Index('IDX_opencode_config_sync_agent', ['agentId'], { unique: true })
@Index('IDX_opencode_config_sync_status', ['syncStatus', 'updatedAt'])
export class OpencodeConfigSyncTargetEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  /** SHA-256 of effective config + merged secrets the agent should have. */
  @Column({ type: 'varchar', length: 64, name: 'desired_revision' })
  desiredRevision!: string;

  @Column({ type: 'varchar', length: 64, name: 'applied_revision', nullable: true })
  appliedRevision?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'sync_status', default: 'pending' })
  syncStatus!: OpencodeConfigSyncStatus;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError?: string | null;

  @Column({ type: 'timestamp', name: 'last_synced_at', nullable: true })
  lastSyncedAt?: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
