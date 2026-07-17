import { createAes256GcmTransformer, createJsonAes256GcmTransformer } from '@shared/backend/util-crypto';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('email_deliveries')
@Index('idx_email_deliveries_scope_created_at', ['scopeKey', 'createdAt'])
@Index('idx_email_deliveries_event_id', ['eventId'])
export class EmailDeliveryEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'event_id' })
  eventId!: string;

  @Column({ type: 'varchar', length: 128, name: 'event_type' })
  eventType!: string;

  @Column({ type: 'varchar', length: 64, name: 'scope_key' })
  scopeKey!: string;

  @Column({ type: 'varchar', length: 128, name: 'template_key' })
  templateKey!: string;

  /** Recipient address; encrypted at rest via AES-256-GCM. */
  @Column({
    type: 'text',
    name: 'recipient',
    transformer: createAes256GcmTransformer(),
  })
  recipient!: string;

  /**
   * Sanitized template context for debugging (no OTP/reset codes).
   * Encrypted at rest via AES-256-GCM JSON transformer.
   */
  @Column({
    type: 'text',
    name: 'template_context',
    nullable: true,
    transformer: createJsonAes256GcmTransformer(),
  })
  templateContext?: Record<string, unknown> | null;

  @Column({ type: 'boolean', name: 'success' })
  success!: boolean;

  @Column({ type: 'int', name: 'attempt' })
  attempt!: number;

  /** SMTP/error details; encrypted at rest via AES-256-GCM. */
  @Column({
    type: 'text',
    name: 'error_message',
    nullable: true,
    transformer: createAes256GcmTransformer(),
  })
  errorMessage?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
