import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { TaxCategory } from '../constants/tax-category.constants';

import { InvoiceEntity } from './invoice.entity';

@Entity('billing_invoice_credit_documents')
export class InvoiceCreditDocumentEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId!: string;

  @ManyToOne(() => InvoiceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice?: InvoiceEntity;

  @Column({ type: 'varchar', length: 64, name: 'document_number' })
  documentNumber!: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'credit_net' })
  creditNet!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'credit_gross' })
  creditGross!: number;

  @Column({
    type: 'enum',
    enum: TaxCategory,
    enumName: 'tax_category_enum',
    name: 'tax_category',
    default: TaxCategory.STANDARD,
  })
  taxCategory!: TaxCategory;

  @Column({ type: 'varchar', length: 255, name: 'description', default: '' })
  description!: string;

  @Column({ type: 'varchar', length: 512, name: 'pdf_storage_key' })
  pdfStorageKey!: string;

  @Column({ type: 'varchar', length: 50, name: 'reason', default: 'withdrawal' })
  reason!: string;

  @Column({ type: 'timestamp', name: 'withdrawn_at' })
  withdrawnAt!: Date;

  /** Durable idempotency key for one-shot billing side effects (e.g. `config_change:{changeId}`). */
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'source_ref' })
  sourceRef?: string | null;

  /**
   * True once invoice balance reduction and any carry-forward OP for this credit have been applied.
   * Lets retries finish settlement if the worker died after inserting the credit row.
   */
  /** VAT of the credit (gross − net), stored so bookings and exports never recompute it. */
  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true, name: 'credit_tax' })
  creditTax?: number | null;

  /** Percent rate of the credited line (from the original invoice's tax snapshot). */
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, name: 'tax_rate' })
  taxRate?: number | null;

  @Column({ type: 'boolean', name: 'settlement_complete', default: false })
  settlementComplete!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
