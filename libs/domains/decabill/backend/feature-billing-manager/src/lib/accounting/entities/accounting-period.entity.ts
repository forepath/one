import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { AccountingPeriodStatus } from '../constants/accounting.constants';

/** Monthly posting period of a fiscal year; locking it is the GoBD Festschreibung. */
@Entity('billing_accounting_periods')
@Index('uq_billing_accounting_periods_year_index', ['fiscalYearId', 'periodIndex'], { unique: true })
export class AccountingPeriodEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'fiscal_year_id' })
  fiscalYearId!: string;

  /** 1-based month index within the fiscal year. */
  @Column({ type: 'int', name: 'period_index' })
  periodIndex!: number;

  @Column({ type: 'date', name: 'start_date' })
  startDate!: string;

  @Column({ type: 'date', name: 'end_date' })
  endDate!: string;

  @Column({ type: 'varchar', length: 16, name: 'status', default: AccountingPeriodStatus.OPEN })
  status!: AccountingPeriodStatus;

  @Column({ type: 'timestamp', nullable: true, name: 'locked_at' })
  lockedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'locked_by_user_id' })
  lockedByUserId?: string | null;
}
