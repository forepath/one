import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { JournalEntryKind, JournalSourceType } from '../constants/accounting.constants';

import { AccountingJournalLineEntity } from './accounting-journal-line.entity';

/**
 * Journal entry (Buchungssatz). Immutable once written: corrections are reversal entries (`reversalOfEntryId`)
 * plus a new entry. `entryNumber` is gap-free and ascending per fiscal year (GoBD journal function).
 */
@Entity('billing_accounting_journal_entries')
@Index('uq_billing_accounting_journal_entries_year_number', ['fiscalYearId', 'entryNumber'], { unique: true })
@Index('uq_billing_accounting_journal_entries_idempotency', ['idempotencyKey'], { unique: true })
@Index('idx_billing_accounting_journal_entries_source', ['sourceType', 'sourceId'])
@Index('idx_billing_accounting_journal_entries_posting_date', ['postingDate'])
export class AccountingJournalEntryEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'fiscal_year_id' })
  fiscalYearId!: string;

  @Column({ type: 'uuid', name: 'period_id' })
  periodId!: string;

  @Column({ type: 'int', name: 'entry_number' })
  entryNumber!: number;

  /** Booking date (ISO) deciding the period. */
  @Column({ type: 'date', name: 'posting_date' })
  postingDate!: string;

  /** Belegdatum. */
  @Column({ type: 'date', name: 'document_date' })
  documentDate!: string;

  /** Belegnummer (invoice number, bank reference …). */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'document_number' })
  documentNumber?: string | null;

  @Column({ type: 'varchar', length: 255, name: 'description' })
  description!: string;

  @Column({ type: 'varchar', length: 24, name: 'kind' })
  kind!: JournalEntryKind;

  @Column({ type: 'varchar', length: 32, name: 'source_type' })
  sourceType!: JournalSourceType;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'source_id' })
  sourceId?: string | null;

  /** Business event of the source (`issued`, `voided`, `payment`, `fee` …). */
  @Column({ type: 'varchar', length: 48, nullable: true, name: 'source_event' })
  sourceEvent?: string | null;

  /** `{sourceType}:{sourceId}:{event}` for automatic entries; random for manual ones. */
  @Column({ type: 'varchar', length: 191, name: 'idempotency_key' })
  idempotencyKey!: string;

  /** Tenant dimension (customer/supplier tenant; `null` for entity-wide entries such as closings). */
  @Index('idx_billing_accounting_journal_entries_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tenant_id' })
  tenantId?: string | null;

  /** Document currency (lines carry original amounts when it differs from the functional currency). */
  @Column({ type: 'varchar', length: 3, name: 'currency' })
  currency!: string;

  /** Units of document currency per 1 functional currency (ECB convention); `1` for functional currency. */
  @Column({ type: 'decimal', precision: 18, scale: 8, name: 'fx_rate', default: 1 })
  fxRate!: number | string;

  /** Sum of debits (= sum of credits) in functional currency. */
  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'total' })
  total!: number | string;

  @Column({ type: 'uuid', nullable: true, name: 'reversal_of_entry_id' })
  reversalOfEntryId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'reversed_by_entry_id' })
  reversedByEntryId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => AccountingJournalLineEntity, (line) => line.entry)
  lines?: AccountingJournalLineEntity[];
}
