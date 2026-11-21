import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Gap-free journal numbering per fiscal year (incremented in the posting transaction). */
@Entity('billing_accounting_entry_number_sequences')
export class AccountingEntryNumberSequenceEntity {
  @PrimaryColumn({ type: 'uuid', name: 'fiscal_year_id' })
  fiscalYearId!: string;

  @Column({ type: 'int', name: 'last_value', default: 0 })
  lastValue!: number;
}
