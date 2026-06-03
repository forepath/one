import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';

import { InvoiceEntity } from './invoice.entity';

@Entity('billing_invoice_void_documents')
export class InvoiceVoidDocumentEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', unique: true, name: 'invoice_id' })
  invoiceId!: string;

  @OneToOne(() => InvoiceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice?: InvoiceEntity;

  @Column({ type: 'varchar', length: 64, name: 'document_number' })
  documentNumber!: string;

  @Column({ type: 'varchar', length: 512, name: 'pdf_storage_key' })
  pdfStorageKey!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
