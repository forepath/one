import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

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

  @Column({ type: 'varchar', length: 512, name: 'pdf_storage_key' })
  pdfStorageKey!: string;

  @Column({ type: 'varchar', length: 50, name: 'reason', default: 'withdrawal' })
  reason!: string;

  @Column({ type: 'timestamp', name: 'withdrawn_at' })
  withdrawnAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
