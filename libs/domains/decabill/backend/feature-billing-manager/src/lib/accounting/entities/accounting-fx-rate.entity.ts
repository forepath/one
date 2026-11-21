import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Exchange rate: units of `currency` per 1 functional currency on `rateDate` (ECB reference rate convention). */
@Entity('billing_accounting_fx_rates')
@Index('uq_billing_accounting_fx_rates', ['currency', 'rateDate', 'source'], { unique: true })
export class AccountingFxRateEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 3, name: 'currency' })
  currency!: string;

  @Column({ type: 'date', name: 'rate_date' })
  rateDate!: string;

  @Column({ type: 'decimal', precision: 18, scale: 8, name: 'rate' })
  rate!: number | string;

  /** `ecb` (fetched) or `manual` (override; preferred over ecb for the same date). */
  @Column({ type: 'varchar', length: 16, name: 'source' })
  source!: 'ecb' | 'manual';

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
