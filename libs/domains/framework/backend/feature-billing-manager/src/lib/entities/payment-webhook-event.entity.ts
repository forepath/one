import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('billing_payment_webhook_events')
export class PaymentWebhookEventEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 50, name: 'processor' })
  processor!: string;

  @Column({ type: 'varchar', length: 255, unique: true, name: 'event_id' })
  eventId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'payload_hash' })
  payloadHash?: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt!: Date;

  @Column({ type: 'varchar', length: 50, name: 'result' })
  result!: string;
}
