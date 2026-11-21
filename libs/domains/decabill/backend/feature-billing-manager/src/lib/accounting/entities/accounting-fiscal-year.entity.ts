import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { FiscalYearStatus } from '../constants/accounting.constants';

/** Fiscal year (Wirtschaftsjahr, max. 12 months; shorter first/last years allowed). */
@Entity('billing_accounting_fiscal_years')
@Index('uq_billing_accounting_fiscal_years_start', ['startDate'], { unique: true })
export class AccountingFiscalYearEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 32, name: 'name' })
  name!: string;

  /** ISO date. */
  @Column({ type: 'date', name: 'start_date' })
  startDate!: string;

  @Column({ type: 'date', name: 'end_date' })
  endDate!: string;

  /** Chart used for the whole year. */
  @Column({ type: 'uuid', name: 'chart_id' })
  chartId!: string;

  @Column({ type: 'varchar', length: 16, name: 'status', default: FiscalYearStatus.OPEN })
  status!: FiscalYearStatus;

  @Column({ type: 'timestamp', nullable: true, name: 'closed_at' })
  closedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'closed_by_user_id' })
  closedByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
