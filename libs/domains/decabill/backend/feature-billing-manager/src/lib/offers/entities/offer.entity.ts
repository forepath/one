import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { CustomerType } from '../../constants/customer-type.constants';
import { EinvoiceTaxCategoryCode, TaxMode } from '../../constants/tax-mode.constants';
import { OfferStatus } from '../constants/offer-status.constants';

import { OfferLineItemEntity } from './offer-line-item.entity';

@Entity('billing_offers')
export class OfferEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'offer_number' })
  offerNumber?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'number_scope' })
  numberScope?: string | null;

  @Column({
    type: 'enum',
    enum: OfferStatus,
    enumName: 'offer_status_enum',
    default: OfferStatus.DRAFT,
    name: 'status',
  })
  status!: OfferStatus;

  @Column({ type: 'varchar', length: 10, default: 'EUR', name: 'currency' })
  currency!: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, name: 'subtotal_net' })
  subtotalNet!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, name: 'tax_total' })
  taxTotal!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, name: 'total_gross' })
  totalGross!: number;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tax_mode' })
  taxMode?: TaxMode | null;

  @Column({ type: 'varchar', length: 2, nullable: true, name: 'tax_country_code' })
  taxCountryCode?: string | null;

  @Column({ type: 'text', nullable: true, name: 'tax_note' })
  taxNote?: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true, name: 'einvoice_tax_category_code' })
  einvoiceTaxCategoryCode?: EinvoiceTaxCategoryCode | string | null;

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, name: 'resolved_tax_rate' })
  resolvedTaxRate?: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'buyer_vat_id' })
  buyerVatId?: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true, name: 'buyer_country' })
  buyerCountry?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'buyer_customer_type' })
  buyerCustomerType?: CustomerType | null;

  @Column({ type: 'varchar', length: 2, nullable: true, name: 'issuer_country' })
  issuerCountry?: string | null;

  @Column({ type: 'boolean', nullable: true, name: 'issuer_is_in_eu' })
  issuerIsInEu?: boolean | null;

  @Column({ type: 'timestamp', nullable: true, name: 'expires_at' })
  expiresAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'archived_at' })
  archivedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'accepted_at' })
  acceptedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'declined_at' })
  declinedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'expired_at' })
  expiredAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'revoked_at' })
  revokedAt?: Date | null;

  @Column({ type: 'boolean', default: false, name: 'bill_to_open_positions' })
  billToOpenPositions!: boolean;

  @Column({ type: 'varchar', length: 512, nullable: true, name: 'pdf_storage_key' })
  pdfStorageKey?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => OfferLineItemEntity, (line) => line.offer)
  lineItems?: OfferLineItemEntity[];
}
