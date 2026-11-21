import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A chart of accounts. Created from a country template (curated accounts with statement positions and VAT boxes)
 * or empty; every account stays editable. Fiscal years reference one chart; a different chart can only be chosen
 * when a new fiscal year is opened (no mid-year switch).
 */
@Entity('billing_accounting_charts')
@Index('uq_billing_accounting_charts_code', ['code'], { unique: true })
export class AccountingChartEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** Stable short code, e.g. `DE-SKR03`, `FR-PCG`, `CUSTOM-1`. */
  @Column({ type: 'varchar', length: 32, name: 'code' })
  code!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  /** ISO country the chart follows (`null` for generic charts). */
  @Column({ type: 'varchar', length: 2, nullable: true, name: 'country' })
  country?: string | null;

  /** Template the chart was created from (`null` = built from scratch or imported). */
  @Column({ type: 'varchar', length: 32, nullable: true, name: 'template_key' })
  templateKey?: string | null;

  /** Number of digits of general-ledger account numbers (DATEV Sachkontenlänge). */
  @Column({ type: 'int', name: 'account_length', default: 4 })
  accountLength!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
