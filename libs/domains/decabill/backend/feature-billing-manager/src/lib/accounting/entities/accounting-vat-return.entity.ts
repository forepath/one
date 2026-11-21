import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type VatReturnStatus = 'draft' | 'submitted' | 'paid';

/**
 * A computed VAT return (UStVA, ZM, OSS, annual return, CA3, VAT100 …) for manual filing. Figures are recomputed
 * while draft; submitting freezes them and locks the accounting periods up to the period end.
 */
@Entity('billing_accounting_vat_returns')
@Index('uq_billing_accounting_vat_returns_period', ['definitionKey', 'periodStart', 'periodEnd'], { unique: true })
export class AccountingVatReturnEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 32, name: 'definition_key' })
  definitionKey!: string;

  @Column({ type: 'date', name: 'period_start' })
  periodStart!: string;

  @Column({ type: 'date', name: 'period_end' })
  periodEnd!: string;

  @Column({ type: 'varchar', length: 16, name: 'status', default: 'draft' })
  status!: VatReturnStatus;

  /** `invoice` (Soll) or `payment` (Ist) basis used for the output side. */
  @Column({ type: 'varchar', length: 16, name: 'vat_basis' })
  vatBasis!: string;

  /** Box id → amount. */
  @Column({ type: 'jsonb', name: 'figures' })
  figures!: Record<string, number>;

  /** Rows of list-type returns (EC sales list per VAT id, OSS per country/rate). */
  @Column({ type: 'jsonb', name: 'details', default: () => "'[]'" })
  details!: Array<Record<string, unknown>>;

  /** Manually entered box values (e.g. DE Kz 39 Sondervorauszahlung). */
  @Column({ type: 'jsonb', name: 'manual_values', default: () => "'{}'" })
  manualValues!: Record<string, number>;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true, name: 'result_amount' })
  resultAmount?: number | string | null;

  @Column({ type: 'timestamp', name: 'computed_at' })
  computedAt!: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'submitted_at' })
  submittedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'submitted_by_user_id' })
  submittedByUserId?: string | null;

  /** Filing receipt (ELSTER Transferticket, BZSt reference …). */
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'filing_reference' })
  filingReference?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'payment_entry_id' })
  paymentEntryId?: string | null;

  @Column({ type: 'text', nullable: true, name: 'note' })
  note?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
