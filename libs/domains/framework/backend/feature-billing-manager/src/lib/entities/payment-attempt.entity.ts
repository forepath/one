import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { InvoiceEntity } from './invoice.entity';

export enum PaymentAttemptStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

@Entity('billing_payment_attempts')
export class PaymentAttemptEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId!: string;

  @ManyToOne(() => InvoiceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice?: InvoiceEntity;

  @Column({ type: 'varchar', length: 50, name: 'processor' })
  processor!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'external_id' })
  externalId?: string;

  @Column({
    type: 'enum',
    enum: PaymentAttemptStatus,
    enumName: 'payment_attempt_status_enum',
    default: PaymentAttemptStatus.PENDING,
  })
  status!: PaymentAttemptStatus;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'amount' })
  amount!: number;

  @Column({ type: 'varchar', length: 10, default: 'EUR', name: 'currency' })
  currency!: string;

  @Column({ type: 'varchar', length: 255, unique: true, name: 'idempotency_key' })
  idempotencyKey!: string;

  @Column({ type: 'jsonb', default: {}, name: 'metadata' })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
