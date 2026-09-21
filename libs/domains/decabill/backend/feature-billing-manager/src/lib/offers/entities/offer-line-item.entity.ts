import { createJsonAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { TaxCategory } from '../../constants/tax-category.constants';
import { OfferFulfillmentStatus } from '../constants/offer-fulfillment-status.constants';
import { OfferLineType } from '../constants/offer-line-type.constants';

import { OfferEntity } from './offer.entity';

@Entity('billing_offer_line_items')
export class OfferLineItemEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'offer_id' })
  offerId!: string;

  @ManyToOne(() => OfferEntity, (offer) => offer.lineItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_id' })
  offer?: OfferEntity;

  @Column({ type: 'int', default: 0, name: 'position' })
  position!: number;

  @Column({
    type: 'enum',
    enum: OfferLineType,
    enumName: 'offer_line_type_enum',
    name: 'line_type',
  })
  lineType!: OfferLineType;

  @Column({ type: 'varchar', length: 500, name: 'description' })
  description!: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 1, name: 'quantity' })
  quantity!: number;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'unit_label' })
  unitLabel?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'unit_price_net' })
  unitPriceNet!: number;

  @Column({
    type: 'enum',
    enum: TaxCategory,
    enumName: 'tax_category_enum',
    default: TaxCategory.STANDARD,
    name: 'tax_category',
  })
  taxCategory!: TaxCategory;

  @Column({ type: 'decimal', precision: 8, scale: 4, name: 'tax_rate' })
  taxRate!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'line_net' })
  lineNet!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'line_tax' })
  lineTax!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'line_gross' })
  lineGross!: number;

  @Column({ type: 'timestamp', nullable: true, name: 'scheduled_at' })
  scheduledAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'fulfilled_at' })
  fulfilledAt?: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'result_subscription_id' })
  resultSubscriptionId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'result_project_id' })
  resultProjectId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'result_invoice_id' })
  resultInvoiceId?: string | null;

  @Column({
    type: 'enum',
    enum: OfferFulfillmentStatus,
    enumName: 'offer_fulfillment_status_enum',
    default: OfferFulfillmentStatus.PENDING,
    name: 'fulfillment_status',
  })
  fulfillmentStatus!: OfferFulfillmentStatus;

  @Column({ type: 'text', nullable: true, name: 'fulfillment_error' })
  fulfillmentError?: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'project_template_payload' })
  projectTemplatePayload?: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true, name: 'plan_id' })
  planId?: string | null;

  @Column({
    type: 'text',
    nullable: true,
    name: 'effective_config_snapshot',
    transformer: createJsonAes256GcmTransformer(),
  })
  effectiveConfigSnapshot?: Record<string, unknown> | null;

  @Column({
    type: 'text',
    nullable: true,
    name: 'addon_configs_snapshot',
    transformer: createJsonAes256GcmTransformer(),
  })
  addonConfigsSnapshot?: Record<string, Record<string, string>> | null;

  @Column({ type: 'jsonb', nullable: true, name: 'addon_ids' })
  addonIds?: string[] | null;

  @Column({ type: 'jsonb', nullable: true, name: 'preferred_alternatives' })
  preferredAlternatives?: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false, name: 'auto_backorder' })
  autoBackorder!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'promotion_code' })
  promotionCode?: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'pricing_snapshot' })
  pricingSnapshot?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'plan_name_snapshot' })
  planNameSnapshot?: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'availability_checked_at' })
  availabilityCheckedAt?: Date | null;
}
