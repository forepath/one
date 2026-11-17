import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { InventoryWithdrawalRequestSource, InventoryWithdrawalRequestStatus } from '../constants/inventory.constants';

/**
 * Request to withdraw an article, raised outside the inventory pages (accepted offer line, issued invoice line,
 * subscription period invoice). Stock only moves after an administrator accepts it.
 */
@Entity('billing_inventory_withdrawal_requests')
@Index('uq_billing_inventory_withdrawal_requests_source_ref', ['sourceRef'], { unique: true })
export class InventoryWithdrawalRequestEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'uuid', name: 'article_id' })
  articleId!: string;

  @Column({ type: 'decimal', precision: 14, scale: 3, name: 'quantity' })
  quantity!: number | string;

  @Column({ type: 'varchar', length: 16, default: InventoryWithdrawalRequestStatus.PENDING, name: 'status' })
  status!: InventoryWithdrawalRequestStatus;

  @Column({ type: 'varchar', length: 16, name: 'source_type' })
  sourceType!: InventoryWithdrawalRequestSource;

  /** Idempotency key of the originating position (`offer-line:{id}`, `invoice-line:{id}`, …). */
  @Column({ type: 'varchar', length: 255, name: 'source_ref' })
  sourceRef!: string;

  /** Human-readable origin (document number and position), e.g. `INV-2026-00012, pos. 2`. */
  @Column({ type: 'varchar', length: 255, name: 'source_label' })
  sourceLabel!: string;

  @Column({ type: 'uuid', nullable: true, name: 'user_id' })
  userId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'offer_id' })
  offerId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'invoice_id' })
  invoiceId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'subscription_id' })
  subscriptionId?: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'decided_at' })
  decidedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'decided_by_user_id' })
  decidedByUserId?: string | null;

  @Column({ type: 'text', nullable: true, name: 'decision_note' })
  decisionNote?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
