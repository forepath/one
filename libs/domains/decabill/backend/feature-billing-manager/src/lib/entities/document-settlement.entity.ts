import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { SettlementDocumentType, SettlementSource, SettlementType } from '../constants/settlement.constants';

/**
 * One event that changed the open balance of a customer or supplier invoice. Balance due and status are derived
 * from the document total and its settlements, so "paid by cash", "settled by credit note" and "written off" stay
 * distinguishable, partial payments work, and every change has a date and a source for bookkeeping.
 */
@Entity('billing_document_settlements')
@Index('uq_billing_document_settlements_source', ['documentType', 'documentId', 'type', 'sourceRef'], { unique: true })
@Index('idx_billing_document_settlements_document', ['documentType', 'documentId'])
export class DocumentSettlementEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 24, name: 'document_type' })
  documentType!: SettlementDocumentType;

  @Column({ type: 'uuid', name: 'document_id' })
  documentId!: string;

  @Column({ type: 'varchar', length: 24, name: 'type' })
  type!: SettlementType;

  /** Positive amount in document currency. */
  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'amount' })
  amount!: number | string;

  @Column({ type: 'varchar', length: 10, name: 'currency' })
  currency!: string;

  /** Economic date (money received/paid, credit note date …). */
  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurredAt!: Date;

  @Column({ type: 'varchar', length: 24, name: 'source' })
  source!: SettlementSource;

  /** Idempotency reference of the source (processor event/charge id, bank transaction id, credit document id …). */
  @Column({ type: 'varchar', length: 191, name: 'source_ref' })
  sourceRef!: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'processor' })
  processor?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'external_id' })
  externalId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'payment_attempt_id' })
  paymentAttemptId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'credit_document_id' })
  creditDocumentId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'payment_refund_id' })
  paymentRefundId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'bank_transaction_id' })
  bankTransactionId?: string | null;

  /** Counter-document of a credit transfer (the document the credit came from / went to). */
  @Column({ type: 'uuid', nullable: true, name: 'related_document_id' })
  relatedDocumentId?: string | null;

  /** Settlement this one reverses (payment reversal of a payment). */
  @Column({ type: 'uuid', nullable: true, name: 'reverses_settlement_id' })
  reversesSettlementId?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'note' })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
