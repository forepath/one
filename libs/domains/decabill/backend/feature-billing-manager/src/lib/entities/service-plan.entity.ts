import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';

import { ServiceTypeEntity } from './service-type.entity';

/** Ordered icon + text line for catalog / ordering UIs (icon is an opaque client-defined key). */
export interface ServicePlanOrderingHighlight {
  icon: string;
  text: string;
}

export enum BillingIntervalType {
  HOUR = 'hour',
  DAY = 'day',
  MONTH = 'month',
}

@Entity('billing_service_plans')
export class ServicePlanEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'service_type_id' })
  serviceTypeId!: string;

  @ManyToOne(() => ServiceTypeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_type_id' })
  serviceType?: ServiceTypeEntity;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string;

  @Column({ type: 'enum', enum: BillingIntervalType, name: 'billing_interval_type' })
  billingIntervalType!: BillingIntervalType;

  @Column({ type: 'int', name: 'billing_interval_value' })
  billingIntervalValue!: number;

  @Column({ type: 'int', nullable: true, name: 'billing_day_of_month' })
  billingDayOfMonth?: number;

  @Column({ type: 'boolean', name: 'cancel_at_period_end', default: true })
  cancelAtPeriodEnd!: boolean;

  @Column({ type: 'int', name: 'min_commitment_days', default: 0 })
  minCommitmentDays!: number;

  @Column({ type: 'int', name: 'notice_days', default: 0 })
  noticeDays!: number;

  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true, name: 'base_price' })
  basePrice?: string;

  @Column({ type: 'numeric', precision: 8, scale: 4, nullable: true, name: 'margin_percent' })
  marginPercent?: string;

  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true, name: 'margin_fixed' })
  marginFixed?: string;

  @Column({ type: 'jsonb', name: 'provider_config_defaults', default: () => "'{}'::jsonb" })
  providerConfigDefaults!: Record<string, unknown>;

  @Column({ type: 'jsonb', name: 'ordering_highlights', default: () => "'[]'::jsonb" })
  orderingHighlights!: ServicePlanOrderingHighlight[];

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', name: 'allow_customer_location_selection', default: false })
  allowCustomerLocationSelection!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
