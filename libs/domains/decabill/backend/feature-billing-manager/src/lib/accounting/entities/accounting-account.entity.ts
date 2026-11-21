import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { AccountingAccountRole, AccountingAccountType } from '../constants/accounting.constants';

/** General-ledger account of a chart. */
@Entity('billing_accounting_accounts')
@Index('uq_billing_accounting_accounts_chart_number', ['chartId', 'number'], { unique: true })
export class AccountingAccountEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Index('idx_billing_accounting_accounts_chart')
  @Column({ type: 'uuid', name: 'chart_id' })
  chartId!: string;

  @Column({ type: 'varchar', length: 20, name: 'number' })
  number!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 16, name: 'type' })
  type!: AccountingAccountType;

  /** System role used by posting rules (unique per chart). */
  @Column({ type: 'varchar', length: 48, nullable: true, name: 'role' })
  role?: AccountingAccountRole | null;

  /**
   * Statement position code of the chart's country profile (e.g. `BS.A.B.IV` cash/bank, `PL.1` revenue,
   * `EUR.ein.umsatz`). Drives balance sheet, P&L and cash-basis reports.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'statement_position' })
  statementPosition?: string | null;

  /**
   * Automatic account (DATEV Automatikkonto): postings derive VAT from `defaultTaxCodeId` without an explicit
   * tax code on the line.
   */
  @Column({ type: 'boolean', name: 'is_automatic', default: false })
  isAutomatic!: boolean;

  @Column({ type: 'uuid', nullable: true, name: 'default_tax_code_id' })
  defaultTaxCodeId?: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  /** Created from the template (editable, but flagged so imports and resets can tell them apart). */
  @Column({ type: 'boolean', name: 'is_template', default: false })
  isTemplate!: boolean;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string | null;

  /** Mapping codes for exports: `{ saftGroupingCategory, saftGroupingCode, xbrl, fecCompte }`. */
  @Column({ type: 'jsonb', nullable: true, name: 'external_codes' })
  externalCodes?: Record<string, string> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
