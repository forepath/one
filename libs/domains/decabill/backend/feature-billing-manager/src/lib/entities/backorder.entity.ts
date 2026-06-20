import { createJsonAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum BackorderStatus {
  PENDING = 'pending',
  RETRYING = 'retrying',
  FULFILLED = 'fulfilled',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

@Entity('billing_backorders')
export class BackorderEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'uuid', name: 'service_type_id' })
  serviceTypeId!: string;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId!: string;

  /** Requested config snapshot; encrypted at rest via AES-256-GCM. */
  @Column({
    type: 'text',
    name: 'requested_config_snapshot',
    nullable: true,
    transformer: createJsonAes256GcmTransformer(),
  })
  requestedConfigSnapshot!: Record<string, unknown>;

  @Column({ type: 'enum', enum: BackorderStatus, name: 'status', default: BackorderStatus.PENDING })
  status!: BackorderStatus;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'failure_reason' })
  failureReason?: string;

  @Column({ type: 'jsonb', name: 'provider_errors', default: () => "'{}'::jsonb" })
  providerErrors!: Record<string, unknown>;

  @Column({ type: 'jsonb', name: 'preferred_alternatives', default: () => "'{}'::jsonb" })
  preferredAlternatives!: Record<string, unknown>;

  @Column({ type: 'timestamp', nullable: true, name: 'retry_after' })
  retryAfter?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
