import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { PromotionRedemptionContext, PromotionRedemptionStatus } from '../constants/promotion.constants';

import { PromotionEntity } from './promotion.entity';
import { SubscriptionEntity } from './subscription.entity';

@Entity('billing_promotion_redemptions')
export class PromotionRedemptionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'promotion_id' })
  promotionId!: string;

  @ManyToOne(() => PromotionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'promotion_id' })
  promotion?: PromotionEntity;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId!: string;

  @ManyToOne(() => SubscriptionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: SubscriptionEntity;

  @Column({ type: 'varchar', length: 64, name: 'code_snapshot' })
  codeSnapshot!: string;

  @Column({
    type: 'enum',
    enum: PromotionRedemptionContext,
    enumName: 'promotion_redemption_context_enum',
    name: 'redemption_context',
  })
  redemptionContext!: PromotionRedemptionContext;

  @Column({
    type: 'enum',
    enum: PromotionRedemptionStatus,
    enumName: 'promotion_redemption_status_enum',
    default: PromotionRedemptionStatus.ACTIVE,
    name: 'status',
  })
  status!: PromotionRedemptionStatus;

  @Column({ type: 'timestamp', name: 'redeemed_at' })
  redeemedAt!: Date;

  @Column({ type: 'timestamp', name: 'benefit_starts_at' })
  benefitStartsAt!: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'benefit_ends_at' })
  benefitEndsAt?: Date;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true, name: 'remaining_amount_net' })
  remainingAmountNet?: number;

  @Column({ type: 'int', nullable: true, name: 'remaining_billing_periods' })
  remainingBillingPeriods?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
