import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type FinancialAccountKind = 'bank' | 'cash' | 'processor' | 'other';

/**
 * A bank account, cash box or payment-processor balance whose transactions are imported from files (or synced
 * from the processor API). `tenantId` null = shared by all tenants (visible only in global views).
 */
@Entity('billing_accounting_financial_accounts')
@Index('idx_billing_accounting_financial_accounts_iban', ['iban'])
export class AccountingFinancialAccountEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tenant_id' })
  tenantId?: string | null;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: FinancialAccountKind;

  @Column({ type: 'varchar', length: 34, nullable: true, name: 'iban' })
  iban?: string | null;

  /** National account number when there is no IBAN (BBAN, processor account id …). */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'account_number' })
  accountNumber?: string | null;

  @Column({ type: 'varchar', length: 11, nullable: true, name: 'bic' })
  bic?: string | null;

  @Column({ type: 'varchar', length: 3, name: 'currency', default: 'EUR' })
  currency!: string;

  /** Ledger account (number in the active chart) the transactions are booked on. */
  @Column({ type: 'varchar', length: 20, name: 'ledger_account_number' })
  ledgerAccountNumber!: string;

  /** Processor for `processor` accounts (`stripe`, `paypal` …); enables API sync where supported. */
  @Column({ type: 'varchar', length: 32, nullable: true, name: 'processor' })
  processor?: string | null;

  /** Last known closing balance from statements (balance continuity checks). */
  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true, name: 'last_closing_balance' })
  lastClosingBalance?: number | string | null;

  @Column({ type: 'date', nullable: true, name: 'last_closing_date' })
  lastClosingDate?: string | null;

  /** Processor sync cursor (e.g. last Stripe balance transaction id / created timestamp). */
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'sync_cursor' })
  syncCursor?: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'last_synced_at' })
  lastSyncedAt?: Date | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
