import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ServicePlanEntity } from './service-plan.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PENDING_BACKORDER = 'pending_backorder',
  PENDING_CANCEL = 'pending_cancel',
  CANCELED = 'canceled',
}

@Entity('billing_subscriptions')
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 50, unique: true, name: 'number' })
  number!: string;

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

  @Column({ type: 'timestamp', nullable: true, name: 'resumed_at' })
  resumedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
