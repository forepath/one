import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

import {
  PromotionAdvantageConfig,
  PromotionAdvantageType,
  PromotionSubscriptionEligibility,
} from '../constants/promotion.constants';

@Entity('billing_promotions')
@Unique('uq_billing_promotions_tenant_code', ['tenantId', 'code'])
export class PromotionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64, name: 'code' })
  code!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string;

  @Column({ type: 'timestamp', name: 'redeemable_from' })
  redeemableFrom!: Date;

  @Column({ type: 'timestamp', name: 'redeemable_to' })
  redeemableTo!: Date;

  @Column({ type: 'int', nullable: true, name: 'max_total_redemptions' })
  maxTotalRedemptions?: number;

  @Column({ type: 'int', default: 1, name: 'max_per_user_redemptions' })
  maxPerUserRedemptions!: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({
    type: 'enum',
    enum: PromotionAdvantageType,
    enumName: 'promotion_advantage_type_enum',
    name: 'advantage_type',
  })
  advantageType!: PromotionAdvantageType;

  @Column({ type: 'jsonb', name: 'advantage_config', default: () => "'{}'::jsonb" })
  advantageConfig!: PromotionAdvantageConfig;

  @Column({ type: 'jsonb', nullable: true, name: 'applicable_plan_ids' })
  applicablePlanIds?: string[] | null;

  @Column({
    type: 'enum',
    enum: PromotionSubscriptionEligibility,
    enumName: 'promotion_subscription_eligibility_enum',
    name: 'subscription_eligibility',
    default: PromotionSubscriptionEligibility.BOTH,
  })
  subscriptionEligibility!: PromotionSubscriptionEligibility;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
