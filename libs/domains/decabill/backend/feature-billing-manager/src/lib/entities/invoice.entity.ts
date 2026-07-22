import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { AutoPaymentStatus } from '../constants/auto-payment-status.constants';
import { CustomerType } from '../constants/customer-type.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { EinvoiceTaxCategoryCode, TaxMode } from '../constants/tax-mode.constants';

import { ProjectEntity } from '../projects/entities/project.entity';

import { InvoiceLineItemEntity } from './invoice-line-item.entity';
import { SubscriptionEntity } from './subscription.entity';

@Entity('billing_invoices')
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'subscription_id', nullable: true })
  subscriptionId?: string;

  @ManyToOne(() => SubscriptionEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: SubscriptionEntity;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'uuid', name: 'project_id', nullable: true })
  projectId?: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'project_id' })
  project?: ProjectEntity;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'invoice_number' })
  invoiceNumber?: string;

  @Column({ type: 'enum', enum: InvoiceStatus, enumName: 'invoice_status_enum', default: InvoiceStatus.DRAFT })
  status!: InvoiceStatus;

  @Column({ type: 'varchar', length: 10, default: 'EUR', name: 'currency' })
  currency!: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, name: 'subtotal_net' })
  subtotalNet!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, name: 'tax_total' })
  taxTotal!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, name: 'total_gross' })
  totalGross!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0, name: 'balance_due' })
  balanceDue!: number;

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

  @Column({ type: 'timestamp', nullable: true, name: 'issued_at' })
  issuedAt?: Date;

  @Column({ type: 'date', nullable: true, name: 'due_date' })
  dueDate?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'voided_at' })
  voidedAt?: Date;

  @Column({ type: 'varchar', length: 512, nullable: true, name: 'pdf_storage_key' })
  pdfStorageKey?: string;

  @Column({ type: 'varchar', length: 512, nullable: true, name: 'time_report_storage_key' })
  timeReportStorageKey?: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'payment_processor' })
  paymentProcessor?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'external_payment_id' })
  externalPaymentId?: string;

  @Column({
    type: 'varchar',
    length: 32,
    name: 'auto_payment_status',
    default: AutoPaymentStatus.IDLE,
  })
  autoPaymentStatus!: AutoPaymentStatus;

  @Column({ type: 'int', name: 'auto_payment_attempt_count', default: 0 })
  autoPaymentAttemptCount!: number;

  @Column({ type: 'timestamp', nullable: true, name: 'auto_payment_next_retry_at' })
  autoPaymentNextRetryAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => InvoiceLineItemEntity, (line) => line.invoice)
  lineItems?: InvoiceLineItemEntity[];
}

/** @deprecated Use InvoiceEntity */
export { InvoiceEntity as InvoiceRefEntity };
