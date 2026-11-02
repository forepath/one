import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { ServicePlanEntity } from './service-plan.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PENDING_BACKORDER = 'pending_backorder',
  PENDING_CANCEL = 'pending_cancel',
  PENDING_WITHDRAWAL = 'pending_withdrawal',
  PENDING_INSTANT_CANCEL = 'pending_instant_cancel',
  PENDING_CONFIG_CHANGE = 'pending_config_change',
  CANCELED = 'canceled',
}

/** Teardown phase recorded on withdrawal so the queued job knows how to bill and refund. */
export type WithdrawalTeardownPhase = 'unprovisioned' | 'withdrawal_period';

@Entity('billing_subscriptions')
@Unique('uq_billing_subscriptions_number_scope_number', ['numberScope', 'number'])
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 50, name: 'number' })
  number!: string;

  /** `__shared__` when TENANTS_SHARED_NUMBERS is enabled; otherwise the tenant id. */
  @Column({ type: 'varchar', length: 64, name: 'number_scope', default: '__shared__' })
  numberScope!: string;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId!: string;

  @ManyToOne(() => ServicePlanEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_id' })
  plan?: ServicePlanEntity;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: SubscriptionStatus, name: 'status', default: SubscriptionStatus.ACTIVE })
  status!: SubscriptionStatus;

  @Column({ type: 'timestamp', nullable: true, name: 'current_period_start' })
  currentPeriodStart?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'current_period_end' })
  currentPeriodEnd?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'next_billing_at' })
  nextBillingAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'cancel_requested_at' })
  cancelRequestedAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'cancel_effective_at' })
  cancelEffectiveAt?: Date;

  /**
   * Effective teardown time when it is later than {@link cancelEffectiveAt}: a cancelled Loadweaver cluster keeps
   * running for `LOADWEAVER_TEARDOWN_GRACE_DAYS` after the effective date. Null = teardown at the effective date. The
   * expiration queue selects on `COALESCE(teardown_not_before, cancel_effective_at)` so subscriptions in their grace
   * period never occupy batch slots.
   */
  @Column({ type: 'timestamp', nullable: true, name: 'teardown_not_before' })
  teardownNotBefore?: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'resumed_at' })
  resumedAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'withdrawn_at' })
  withdrawnAt?: Date;

  /**
   * When set, statutory withdrawal is measured from this instant instead of earliest
   * item provisionedAt (e.g. after an automatic price migration).
   */
  @Column({ type: 'timestamp', nullable: true, name: 'statutory_withdrawal_restarted_at' })
  statutoryWithdrawalRestartedAt?: Date;

  @Column({ type: 'varchar', length: 30, nullable: true, name: 'withdraw_phase' })
  withdrawPhase?: WithdrawalTeardownPhase;

  /**
   * When true, the subscription is marked for admin instant removal (abuse / force teardown).
   * Paired with `pending_instant_cancel` and `instantCanceledAt` for the dedicated job.
   */
  @Column({ type: 'boolean', name: 'instant_removal', default: false })
  instantRemoval!: boolean;

  /** Due marker for the instant-cancel job (mirrors `withdrawnAt` for withdrawals). */
  @Column({ type: 'timestamp', nullable: true, name: 'instant_canceled_at' })
  instantCanceledAt?: Date;

  /** Whether a provisioning failure should fall back to an automatic backorder retry. */
  @Column({ type: 'boolean', name: 'auto_backorder', default: false })
  autoBackorder!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
