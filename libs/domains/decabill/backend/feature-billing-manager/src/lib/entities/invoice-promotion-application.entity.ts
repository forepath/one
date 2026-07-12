import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { InvoiceEntity } from './invoice.entity';
import { PromotionRedemptionEntity } from './promotion-redemption.entity';

@Entity('billing_invoice_promotion_applications')
export class InvoicePromotionApplicationEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId!: string;

  @ManyToOne(() => InvoiceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice?: InvoiceEntity;

  @Column({ type: 'uuid', name: 'redemption_id' })
  redemptionId!: string;

  @ManyToOne(() => PromotionRedemptionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'redemption_id' })
  redemption?: PromotionRedemptionEntity;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, name: 'amount_applied_net' })
  amountAppliedNet!: number;

  @Column({ type: 'int', default: 0, name: 'periods_consumed' })
  periodsConsumed!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
