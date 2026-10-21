import { ClientEntity } from '@forepath/identity/backend';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { OpencodeLayerFileEntity } from './opencode-layer-file.entity';

export type OpencodeLayerFileSyncStatus = 'pending' | 'synced' | 'failed';

/**
 * Per-agent emit status for a layer file revision (durable sync-target pattern).
 */
@Entity('opencode_layer_file_sync_targets')
export class OpencodeLayerFileSyncTargetEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'file_id' })
  fileId!: string;

  @ManyToOne(() => OpencodeLayerFileEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  file!: OpencodeLayerFileEntity;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id', foreignKeyConstraintName: 'FK_opencode_layer_file_sync_targets_client' })
  client?: ClientEntity;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @Column({ type: 'varchar', length: 16, name: 'sync_status', default: 'pending' })
  syncStatus!: OpencodeLayerFileSyncStatus;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError?: string | null;

  @Column({ type: 'varchar', length: 64, name: 'synced_sha', nullable: true })
  syncedSha?: string | null;

  @Column({ type: 'timestamp', name: 'last_synced_at', nullable: true })
  lastSyncedAt?: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
