import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { CounterpartyType } from '../constants/accounting.constants';

import { AccountingJournalEntryEntity } from './accounting-journal-entry.entity';

/** One debit or credit line of a journal entry (amounts in functional currency). */
@Entity('billing_accounting_journal_lines')
@Index('idx_billing_accounting_journal_lines_account', ['accountId'])
@Index('idx_billing_accounting_journal_lines_counterparty', ['counterpartyType', 'counterpartyId'])
@Index('idx_billing_accounting_journal_lines_open_item', ['openItemId'])
export class AccountingJournalLineEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'entry_id' })
  entryId!: string;

  @ManyToOne(() => AccountingJournalEntryEntity, (entry) => entry.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entry_id' })
  entry?: AccountingJournalEntryEntity;

  @Column({ type: 'int', name: 'line_no' })
  lineNo!: number;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'debit', default: 0 })
  debit!: number | string;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'credit', default: 0 })
  credit!: number | string;

  /** Signed amount in document currency (debit +, credit −) when it differs from the functional currency. */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true, name: 'original_amount' })
  originalAmount?: number | string | null;

  @Column({ type: 'varchar', length: 3, nullable: true, name: 'original_currency' })
  originalCurrency?: string | null;

  /** Tax code of a revenue/expense line (base) or VAT line (tax). */
  @Column({ type: 'uuid', nullable: true, name: 'tax_code_id' })
  taxCodeId?: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, name: 'tax_rate' })
  taxRate?: number | string | null;

  /** `base` (net amount of a taxed line) or `tax` (the VAT itself); null for untaxed lines. */
  @Column({ type: 'varchar', length: 8, nullable: true, name: 'tax_role' })
  taxRole?: 'base' | 'tax' | 'reverse_tax' | null;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'counterparty_type' })
  counterpartyType?: CounterpartyType | null;

  /** Customer user id or supplier profile id (Personenkonto / open-item owner). */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'counterparty_id' })
  counterpartyId?: string | null;

  /** Document whose open item this receivable/payable line opens or clears (invoice / supplier invoice id). */
  @Column({ type: 'uuid', nullable: true, name: 'open_item_id' })
  openItemId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tenant_id' })
  tenantId?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'cost_center' })
  costCenter?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'description' })
  description?: string | null;

  /** Leistungsdatum / service date. */
  @Column({ type: 'date', nullable: true, name: 'service_date' })
  serviceDate?: string | null;

  /** Destination country of OSS / EU supplies (DATEV EU-Land, OSS return). */
  @Column({ type: 'varchar', length: 2, nullable: true, name: 'eu_country' })
  euCountry?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'eu_vat_id' })
  euVatId?: string | null;
}
