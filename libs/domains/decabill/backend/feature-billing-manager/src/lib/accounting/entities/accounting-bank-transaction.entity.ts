import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { ParsedTransactionDetail } from '../bank-import/bank-import.types';

export type BankTransactionMatchStatus = 'unmatched' | 'suggested' | 'matched' | 'booked' | 'ignored' | 'superseded';

/**
 * Imported bank / processor transaction (normalized). Amount positive = money in. Reconciliation either matches it
 * to documents (settlements) or books it directly against an account (fees, payouts, transfers).
 */
@Entity('billing_accounting_bank_transactions')
@Index('uq_billing_accounting_bank_transactions_dedupe', ['financialAccountId', 'dedupeKey', 'dedupeOrdinal'], {
  unique: true,
})
@Index('idx_billing_accounting_bank_transactions_status', ['financialAccountId', 'matchStatus', 'bookingDate'])
@Index('idx_billing_accounting_bank_transactions_booking', ['financialAccountId', 'bookingDate'])
export class AccountingBankTransactionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'financial_account_id' })
  financialAccountId!: string;

  @Column({ type: 'uuid', name: 'import_id' })
  importId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'statement_id' })
  statementId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tenant_id' })
  tenantId?: string | null;

  @Column({ type: 'varchar', length: 8, name: 'status' })
  status!: 'booked' | 'pending' | 'info';

  @Column({ type: 'date', name: 'booking_date' })
  bookingDate!: string;

  @Column({ type: 'date', nullable: true, name: 'value_date' })
  valueDate?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'amount' })
  amount!: number | string;

  @Column({ type: 'varchar', length: 3, name: 'currency' })
  currency!: string;

  @Column({ type: 'boolean', name: 'is_reversal', default: false })
  isReversal!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'counterparty_name' })
  counterpartyName?: string | null;

  @Column({ type: 'varchar', length: 34, nullable: true, name: 'counterparty_iban' })
  counterpartyIban?: string | null;

  @Column({ type: 'varchar', length: 11, nullable: true, name: 'counterparty_bic' })
  counterpartyBic?: string | null;

  @Column({ type: 'text', nullable: true, name: 'remittance' })
  remittance?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'end_to_end_id' })
  endToEndId?: string | null;

  /** Structured creditor reference (RF / OGM / QRR) when present. */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'structured_reference' })
  structuredReference?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'booking_text' })
  bookingText?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'bank_reference' })
  bankReference?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'bank_transaction_code' })
  bankTransactionCode?: string | null;

  /** Normalized details (batch breakdown, processor gross/fee/net, references …). */
  @Column({ type: 'jsonb', name: 'details', default: () => "'[]'" })
  details!: ParsedTransactionDetail[];

  @Column({ type: 'text', nullable: true, name: 'raw' })
  raw?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'locator' })
  locator?: string | null;

  @Column({ type: 'varchar', length: 64, name: 'dedupe_key' })
  dedupeKey!: string;

  @Column({ type: 'int', name: 'dedupe_ordinal', default: 0 })
  dedupeOrdinal!: number;

  /** Format the line came from (`camt.053`, `mt940`, `csv`, …, `api` for processor sync); drives cross-format dedupe. */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'source_format' })
  sourceFormat?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'match_status', default: 'unmatched' })
  matchStatus!: BankTransactionMatchStatus;

  /** Best reconciliation suggestion `{ targets: [{type,id,amount}], score, reasons }`. */
  @Column({ type: 'jsonb', nullable: true, name: 'suggestion' })
  suggestion?: Record<string, unknown> | null;

  /** Journal entry booking this transaction (direct bookings) — matched documents link via settlements. */
  @Column({ type: 'uuid', nullable: true, name: 'journal_entry_id' })
  journalEntryId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'matched_by_user_id' })
  matchedByUserId?: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'matched_at' })
  matchedAt?: Date | null;

  /** Booked line that replaced this pending line (status `superseded`); restored when that line is rolled back. */
  @Column({ type: 'uuid', nullable: true, name: 'superseded_by_id' })
  supersededById?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
