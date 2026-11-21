import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A statement / report inside an import (camt Stmt, MT940 :20: block, CODA file …). */
@Entity('billing_accounting_bank_statements')
@Index('idx_billing_accounting_bank_statements_account', ['financialAccountId', 'periodTo'])
export class AccountingBankStatementEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'import_id' })
  importId!: string;

  @Column({ type: 'uuid', name: 'financial_account_id' })
  financialAccountId!: string;

  @Column({ type: 'varchar', length: 24, name: 'kind' })
  kind!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'statement_ref' })
  statementRef?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'sequence_number' })
  sequenceNumber?: string | null;

  @Column({ type: 'date', nullable: true, name: 'period_from' })
  periodFrom?: string | null;

  @Column({ type: 'date', nullable: true, name: 'period_to' })
  periodTo?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true, name: 'opening_balance' })
  openingBalance?: number | string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true, name: 'closing_balance' })
  closingBalance?: number | string | null;

  @Column({ type: 'varchar', length: 3, nullable: true, name: 'currency' })
  currency?: string | null;

  @Column({ type: 'jsonb', name: 'warnings', default: () => "'[]'" })
  warnings!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
