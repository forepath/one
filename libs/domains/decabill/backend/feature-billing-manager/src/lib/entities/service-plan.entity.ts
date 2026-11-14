import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';

import { TaxCategory } from '../constants/tax-category.constants';
import { DeliveryTermsCode } from '../constants/document-terms.constants';

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
  YEAR = 'year',
}

@Entity('billing_service_plans')
export class ServicePlanEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** Null when the plan has no service type and deploys nothing. */
  @Column({ type: 'uuid', name: 'service_type_id', nullable: true })
  serviceTypeId!: string | null;

  @ManyToOne(() => ServiceTypeEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'service_type_id' })
  serviceType?: ServiceTypeEntity | null;

  /** Tenant ownership (required when serviceTypeId is null; otherwise mirrors the type). */
  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

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

  /** When true, debt is created at period start (prepaid). Default false preserves arrear billing. */
  @Column({ type: 'boolean', name: 'bill_in_advance', default: false })
  billInAdvance!: boolean;

  /**
   * When true, a nightly job refreshes catalog base price from the provider and migrates
   * eligible subscriptions. Default false — explicit opt-in (price adjustments are regulated).
   */
  @Column({ type: 'boolean', name: 'auto_recalculate_price_daily', default: false })
  autoRecalculatePriceDaily!: boolean;

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

  @Column({ type: 'boolean', name: 'allow_customer_server_type_selection', default: false })
  allowCustomerServerTypeSelection!: boolean;

  @Column({ type: 'jsonb', name: 'allowed_server_types', default: () => "'[]'::jsonb" })
  allowedServerTypes!: string[];

  /** When true, customers may choose provider from allowedProviders at checkout. */
  @Column({ type: 'boolean', name: 'allow_customer_provider_selection', default: false })
  allowCustomerProviderSelection!: boolean;

  /** Provider ids customers may select when allowCustomerProviderSelection is true (subset of service type). */
  @Column({ type: 'jsonb', name: 'allowed_providers', default: () => "'[]'::jsonb" })
  allowedProviders!: string[];

  @Column({
    type: 'enum',
    enum: TaxCategory,
    enumName: 'tax_category_enum',
    name: 'tax_category',
    default: TaxCategory.STANDARD,
  })
  taxCategory!: TaxCategory;

  /** Payment terms: payable within N days (null inherits the global default). */
  @Column({ type: 'int', nullable: true, name: 'payment_due_days' })
  paymentDueDays?: number | null;

  /** Incoterms® 2020 rule or CUSTOM (null inherits the global default). */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'delivery_terms_code' })
  deliveryTermsCode?: DeliveryTermsCode | null;

  /** Named place for an Incoterms rule. */
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'delivery_terms_place' })
  deliveryTermsPlace?: string | null;

  /** Free-text delivery terms when deliveryTermsCode is CUSTOM. */
  @Column({ type: 'text', nullable: true, name: 'delivery_terms_text' })
  deliveryTermsText?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
