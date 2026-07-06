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

export enum PaymentRefundStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

@Entity('billing_payment_refunds')
export class PaymentRefundEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId!: string;

  @ManyToOne(() => InvoiceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice?: InvoiceEntity;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'amount' })
  amount!: number;

  @Column({ type: 'varchar', length: 10, name: 'currency', default: 'EUR' })
  currency!: string;

  @Column({ type: 'varchar', length: 50, name: 'processor' })
  processor!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'external_refund_id' })
  externalRefundId?: string;

  @Column({
    type: 'enum',
    enum: PaymentRefundStatus,
    enumName: 'payment_refund_status_enum',
    name: 'status',
    default: PaymentRefundStatus.PENDING,
  })
  status!: PaymentRefundStatus;

  @Column({ type: 'varchar', length: 50, name: 'reason', default: 'withdrawal' })
  reason!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
